import frappe
@frappe.whitelist()
def get_plan_items(vertical=None):

    items = frappe.db.sql("""
        SELECT
            name,
            item_name,
            item_group,
            custom_plan_level,
            custom_monthly_minimum_usd,
            custom_annual_minimum_usd,
            custom_dependent_modules
        FROM `tabItem`
        WHERE
            custom_vertical IN (%s, 'Both')
            AND disabled = 0
            AND item_group != %s
        ORDER BY item_group ASC, item_name ASC
    """, (vertical, "Core Product"), as_dict=True)


    # Attach Item Prices
    for item in items:

        prices = frappe.db.sql("""
            SELECT price_list, price_list_rate
            FROM `tabItem Price`
            WHERE item_code = %s
        """, item["name"], as_dict=True)

        if not prices:
            item["item_prices"] = []
            continue

        # Group by price_list
        price_map = {}
        for p in prices:
            if p["price_list"] not in price_map:
                price_map[p["price_list"]] = p

        # If all price_lists same → keep only one
        if len(price_map) == 1:
            item["item_prices"] = [list(price_map.values())[0]]
        else:
            item["item_prices"] = list(price_map.values())

    # Group by item_group
    grouped = {}
    for item in items:
        group = item.get("item_group") or "Other"
        grouped.setdefault(group, []).append(item)

    return grouped



from frappe.utils import flt

@frappe.whitelist()
def create_quotation(fx_rate, currency, vertical, plan, customer, item_names, billing, terminals):
    item_names = frappe.parse_json(item_names)
    terminals  = frappe.utils.cint(terminals)

    settings = frappe.get_single("Sales Offer Settings")

    # ── Plan (core) item ──────────────────────────────────────────
    plan_item_code = settings.elite_item if plan == "elite" else settings.base_item
    if not plan_item_code:
        frappe.throw(f"No item configured for '{plan}' plan in Sales Offer Settings.")

    # ── Price lists ───────────────────────────────────────────────
    price_list = settings.yearly_price_list if billing == "annual" else settings.monthly_price_list
    if not price_list:
        frappe.throw(f"No {'yearly' if billing == 'annual' else 'monthly'} price list configured in Sales Offer Settings.")

    # ── Core terminal price (vertical-specific) ───────────────────
    if vertical == "DinePro":
        core_unit_price_monthly = flt(settings.dinepro_core_monthly_price)
        core_unit_price_annual  = flt(settings.dinepro_core_annual_price)
    else:  # StayPro
        core_unit_price_monthly = flt(settings.staypro_core_monthly_price)
        core_unit_price_annual  = flt(settings.staypro_core_annual_price)

    free_terminals     = settings.elite_pos_terminals if plan == "elite" else settings.base_pos_terminals
    billable_terminals = max(0, terminals - flt(free_terminals))

    if billing == "annual":
        core_terminal_rate = core_unit_price_annual * billable_terminals
    else:
        core_terminal_rate = core_unit_price_monthly * billable_terminals

    fx = flt(fx_rate) or 1.0

    def to_currency(usd_amount):
        return usd_amount * fx if currency == "AZN" else usd_amount

    def get_item_rate(item_code):
        """Get the effective rate for an item based on billing period."""
        price_list_rate = flt(frappe.db.get_value(
            "Item Price",
            {"item_code": item_code, "price_list": price_list, "selling": 1},
            "price_list_rate"
        ))
        if billing == "annual":
            custom_rate = flt(frappe.db.get_value("Item", item_code, "custom_annual_minimum_usd"))
        else:
            custom_rate = flt(frappe.db.get_value("Item", item_code, "custom_monthly_minimum_usd"))

        return max(price_list_rate, custom_rate) if price_list_rate else custom_rate

    # ── first_value: terminals cost + sum of all selected item rates ──
    items_total = sum(get_item_rate(item_code) for item_code in item_names)
    first_value = core_terminal_rate + items_total

    # ── second_value: highest individual item minimum among selected items ──
    second_value = 0
    for item_code in item_names:
        if billing == "annual":
            min_rate = flt(frappe.db.get_value("Item", item_code, "custom_annual_minimum_usd"))
        else:
            min_rate = flt(frappe.db.get_value("Item", item_code, "custom_monthly_minimum_usd"))
        if min_rate > second_value:
            second_value = min_rate

    # ── third_value: plan item's own minimum commitment ───────────────
    if billing == "annual":
        third_value = flt(frappe.db.get_value("Item", plan_item_code, "custom_annual_minimum_usd"))
    else:
        third_value = flt(frappe.db.get_value("Item", plan_item_code, "custom_monthly_minimum_usd"))

    # ── Final rate: MAX of all three values ───────────────────────
    final_rate_usd = max(first_value, second_value, third_value)
    frappe.log_error(f"Calculated values - Terminals + Items: {first_value}, Highest Item Minimum: {second_value}, Plan Minimum: {third_value}. Final Rate (USD): {final_rate_usd}")
    chosen = max(enumerate([first_value, second_value, third_value]), key=lambda x: x[1])
    reasons = [
        f"Sum of terminals + all items ({flt(first_value):,.2f} USD)",
        f"Highest single item minimum ({flt(second_value):,.2f} USD)",
        f"Plan minimum commitment ({flt(third_value):,.2f} USD)",
    ]
    price_reason = f"Rate based on: {reasons[chosen[0]]}"

    doc = frappe.new_doc("Quotation")
    doc.quotation_to     = "Customer"
    doc.party_name       = customer
    doc.transaction_date = frappe.utils.today()
    doc.order_type       = "Sales"
    doc.currency         = currency
    doc.conversion_rate  = flt(fx_rate) if currency != "USD" else 1.0
    doc.company          = doc.company = frappe.get_single("Global Defaults").default_company
    # doc.company          = "test"

    # ── Row 1: Plan item with the final calculated rate ───────────
    doc.append("items", {
        "item_code":         plan_item_code,
        "qty":               1,
        "rate":              to_currency(final_rate_usd),
        "custom_final_price": price_reason,
        "custom_billing":    billing,
        "custom_usdaznrate": fx_rate,
        "custom_plan":       plan,
        "custom_vertical":   vertical,
        "custom_currency":   currency,
    })

    # ── Rows 2-N: Add-on items with no rate (rate = 0) ────────────
    for item_code in item_names:
        doc.append("items", {
            "item_code":         item_code,
            "qty":               1,
            "rate":              0,
            "amount":            0,
            "discount_percentage": 100,
        })

    doc.insert()
    doc.submit()

    return doc.name




@frappe.whitelist()
def calculate_total(item_names, billing):
    item_names = frappe.parse_json(item_names)

    settings = frappe.get_single("Sales Offer Settings")
    price_list = settings.yearly_price_list if billing == "annual" else settings.monthly_price_list

    if not price_list:
        frappe.throw(f"No {'yearly' if billing == 'annual' else 'monthly'} price list configured in Sales Offer Settings.")

    total_rate = 0
    for item_code in item_names:
        price_list_rate = flt(frappe.db.get_value(
            "Item Price",
            {"item_code": item_code, "price_list": price_list, "selling": 1},
            "price_list_rate"
        ))

        if billing == "annual":
            custom_rate = flt(frappe.db.get_value("Item", item_code, "custom_annual_minimum_usd"))
        else:
            custom_rate = flt(frappe.db.get_value("Item", item_code, "custom_monthly_minimum_usd"))

        if price_list_rate:
            total_rate += max(price_list_rate, custom_rate)
        else:
            total_rate += custom_rate

    return total_rate