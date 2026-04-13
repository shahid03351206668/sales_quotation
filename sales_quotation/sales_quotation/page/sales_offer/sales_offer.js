frappe.pages["sales-offer"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Sales Offer",
		single_column: true,
	});

	const style = document.createElement("style");
	style.textContent = `
		.pricing-calculator-wrapper {
			background: linear-gradient(to top right, #ffffff, #f9fafb);
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
			padding: 2.5rem 1rem;
		}
		.pricing-container { max-width: 1280px; margin: 0 auto; }
		.pricing-title { font-size: 2.5rem; font-weight: 800; text-align: center; color: #111827; margin-bottom: 0.5rem; letter-spacing: -0.025em; }
		.pricing-title .brand-text { color: #2563eb; }
		.pricing-subtitle { text-align: center; color: #6b7280; margin-bottom: 2rem; font-size: 1.125rem; max-width: 48rem; margin-left: auto; margin-right: auto; }
		.pricing-controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 1rem; align-items: center; margin-bottom: 2rem; }
		.pricing-controls label { font-size: 1rem; font-weight: 500; }
		.pricing-controls select, .pricing-controls input[type="number"] { margin-left: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem; padding: 0.5rem 0.75rem; }
		.pricing-controls input[type="number"] { width: 7rem; }
		.pricing-card { border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 1.5rem; background: #fff; margin-bottom: 2rem; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.1); }
		.card-title { font-size: 1.5rem; font-weight: 700; color: #111827; margin-bottom: 1rem; }
		.terminal-controls { display: flex; justify-content: center; align-items: center; gap: 1rem; max-width: 36rem; margin: 0 auto; }
		.terminal-controls input[type="range"] { flex: 1; }
		.terminal-controls input[type="number"] { width: 6rem; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem; }
		.terminal-info { margin-top: 1rem; color: #374151; }
		.terminal-info > div { font-size: 1rem; margin-bottom: 0.25rem; }
		.terminal-info .highlight { font-weight: 600; }
		.total-price { text-align: center; font-size: 1.875rem; font-weight: 800; color: #16a34a; margin-bottom: 0.25rem; }
		.price-reason { text-align: center; font-size: 0.875rem; color: #6b7280; margin-top: 0.5rem; font-style: italic; }
		.notes-list { list-style: disc; padding-left: 1.5rem; color: #374151; }
		.notes-list li { margin-bottom: 0.5rem; }
		@media (max-width: 640px) {
			.pricing-title { font-size: 1.875rem; }
			.pricing-controls { flex-direction: column; align-items: stretch; }
			.pricing-controls label { display: flex; justify-content: space-between; align-items: center; }
		}
	`;
	document.head.appendChild(style);

	// ─── SETTINGS ─────────────────────────────────────────────────

	let offerSettings = {
		dinepro_core_monthly_price: 0,
		dinepro_core_annual_price: 0,
		staypro_core_monthly_price: 0,
		staypro_core_annual_price: 0,
		base_pos_terminals: 0,
		base_pos_terminals_price: 0,
		elite_pos_terminals: 0,
		elite_pos_terminals_price: 0,
		base_rooms: 0,
		base_rooms_price: 0,
		elite_rooms: 0,
		elite_rooms_price: 0,
	};

	// ─── FUNCTIONS ────────────────────────────────────────────────

	const money = (v) => {
		const currency = document.getElementById("currency").value;
		const fx = window._fxRate || 1;
		return currency === "AZN" ? v * fx : v;
	};

	const fmt = (v) => (Math.round(v * 100) / 100).toFixed(2);

	// ─── FETCH EXCHANGE RATE FROM Currency Exchange DOCTYPE ────────
	const fetchExchangeRate = (callback) => {
    const fromCurrency = "USD";
    const toCurrency = "AZN";

		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Currency Exchange",
				filters: [
					["from_currency", "=", fromCurrency],
					["to_currency", "=", toCurrency],
				],
				fields: ["exchange_rate"],
				order_by: "date desc",
				limit: 1,
			},
			callback: function (r) {
				const rate = r.message && r.message.length > 0
					? parseFloat(r.message[0].exchange_rate)
					: 1.0;
				document.getElementById("fx-display").innerText = rate.toFixed(4);
				window._fxRate = rate;
				if (callback) callback();
			},
			error: function () {
				window._fxRate = 1.0;
				document.getElementById("fx-display").innerText = "1.0000";
				if (callback) callback();
			},
		});
	};

	const getCheckedItemNames = () => {
		const names = [];
		document.querySelectorAll(".addonCheck").forEach((ch) => {
			if (ch.checked) names.push(ch.value);
		});
		return names;
	};

	// ─── Auto-detect plan based on checked items ──────────────────
	const getDetectedPlan = () => {
		const hasElite = [...document.querySelectorAll(".addonCheck")]
			.some(ch => ch.checked && ch.dataset.plan === "elite");
		return hasElite ? "elite" : "base";
	};

	// ─── Returns the correct unit price based on vertical + billing ───
	const getCoreUnitPrice = () => {
		const vertical = document.getElementById("vertical").value;
		const billing = document.getElementById("billing").value;
		if (vertical === "DinePro") {
			return billing === "annual"
				? offerSettings.dinepro_core_annual_price
				: offerSettings.dinepro_core_monthly_price;
		} else {
			return billing === "annual"
				? offerSettings.staypro_core_annual_price
				: offerSettings.staypro_core_monthly_price;
		}
	};

	// ─── Get free terminals/rooms count and standard price ────────
	const getFreeCountAndPrice = () => {
	const vertical = document.getElementById("vertical").value;
	const billing = document.getElementById("billing").value;
	const plan = getDetectedPlan();
	const isAnnual = billing === "annual";

	if (vertical === "DinePro") {
		if (plan === "elite") {
			return {
				count: offerSettings.elite_pos_terminals,
				price: isAnnual
					? offerSettings.elite_pos_terminals_price_annual
					: offerSettings.elite_pos_terminals_price
			};
		} else {
			return {
				count: offerSettings.base_pos_terminals,
				price: isAnnual
					? offerSettings.base_pos_terminals_price_annual
					: offerSettings.base_pos_terminals_price
			};
		}
	} else {
		if (plan === "elite") {
			return {
				count: offerSettings.elite_rooms,
				price: isAnnual
					? offerSettings.elite_rooms_price_annual
					: offerSettings.elite_rooms_price
			};
		} else {
			return {
				count: offerSettings.base_rooms,
				price: isAnnual
					? offerSettings.base_rooms_price_annual
					: offerSettings.base_rooms_price
			};
		}
	}
};

	// ─── Updates the Core card heading and terminal question label ───
	const updateCoreLabels = () => {
		const vertical = document.getElementById("vertical").value;
		const isDinePro = vertical === "DinePro";
		document.getElementById("vertical-title").textContent = "." + vertical;
		document.getElementById("core-card-title").textContent = isDinePro
			? "Core (POS Terminals)"
			: "Core (Rooms)";
		document.getElementById("terminals-question").textContent = isDinePro
			? "How many POS terminals do you need?"
			: "How many rooms do you need?";
		document.getElementById("included-label").textContent = isDinePro
			? "Included (depends on plan & billing):"
			: "Included rooms (depends on plan & billing):";
		document.getElementById("billable-label").textContent = isDinePro
			? "Additional terminals billed:"
			: "Additional rooms billed:";
	};

	const updatePrices = () => {
		const billing = document.getElementById("billing").value;
		const currency = document.getElementById("currency").value;
		const plan = getDetectedPlan();
		const terminals = Math.max(0, parseInt(document.getElementById("terminals").value || 0));

		// ── Update plan badge ──────────────────────────────────────
		const planBadge = document.getElementById("plan-display");
		if (planBadge) {
			if (plan === "elite") {
				planBadge.textContent = "Elite";
				planBadge.style.background = "#7c3aed";
			} else {
				planBadge.textContent = "Base";
				planBadge.style.background = "#2563eb";
			}
		}

		const freeData = getFreeCountAndPrice();
		const freeCount = freeData.count;
		const freeStandardPrice = freeData.price;

		const billable = Math.max(0, terminals - freeCount);
		const terminalUnitPrice = getCoreUnitPrice();

		const billingLabel = billing === "annual" ? "year" : "month";
		document.getElementById("billing-period-core").innerText = billingLabel;
		document.getElementById("billing-period-total").innerText = billingLabel;

		// ── Core price: free terminals standard price + billable terminals ──
		const corePriceUsd = freeStandardPrice + (billable * terminalUnitPrice);
		const corePriceDisplay = money(corePriceUsd);

		document.getElementById("cur1").innerText = currency;
		document.getElementById("cur2").innerText = currency;
		document.getElementById("includedTerminals").innerText = Math.min(terminals, freeCount);
		document.getElementById("billableTerminals").innerText = billable;
		document.getElementById("corePrice").innerText = fmt(corePriceDisplay);

		const checkedItemNames = getCheckedItemNames();

		if (checkedItemNames.length === 0 && terminals === 0) {
			document.getElementById("totalPrice").innerText = fmt(0);
			document.getElementById("price-reason").innerText = "";
			return;
		}

		if (checkedItemNames.length === 0) {
			document.getElementById("totalPrice").innerText = fmt(corePriceDisplay);
			document.getElementById("price-reason").innerText = "Base on: Core terminals only";
			return;
		}

		frappe.call({
			method: "sales_quotation.sales_quotation.page.sales_offer.sales_offer.calculate_total",
			args: {
				item_names: JSON.stringify(checkedItemNames),
				billing: billing,
				terminals: terminals,
				plan: plan,
				vertical: document.getElementById("vertical").value,
			},
			callback: function (r) {
				if (r.message) {
					const finalTotal = money(r.message.total);
					document.getElementById("totalPrice").innerText = fmt(finalTotal);

					// ── Determine which condition wins ──────────────────
					const values = [r.message.first_value, r.message.second_value, r.message.third_value];
					const winnerIndex = values.indexOf(Math.max(...values));
					const reasons = [
						"Sum of terminals + all items",
						"Highest single item minimum",
						"Plan minimum commitment"
					];
					document.getElementById("price-reason").innerText = `Based on: ${reasons[winnerIndex]}`;
				}
			},
		});
	};

	const syncTerminals = (val) => {
		const n = Math.max(0, Math.min(100, parseInt(val || 0)));
		document.getElementById("terminals").value = n;
		document.getElementById("terminalsInput").value = n;
		updatePrices();
	};

	// ─── DEPENDENCY LOGIC ─────────────────────────────────────────

	const handleDependencies = (changedCheckbox) => {
		const allCheckboxes = [...document.querySelectorAll(".addonCheck")];
		const itemName = changedCheckbox.value;
		const isChecked = changedCheckbox.checked;

		if (isChecked) {
			const deps = (changedCheckbox.dataset.deps || "")
				.split(",")
				.map((d) => d.trim())
				.filter(Boolean);

			deps.forEach((depName) => {
				allCheckboxes.forEach((ch) => {
					if (ch.value === depName) ch.checked = true;
				});
			});
		} else {
			allCheckboxes.forEach((ch) => {
				const chDeps = (ch.dataset.deps || "")
					.split(",")
					.map((d) => d.trim())
					.filter(Boolean);
				if (chDeps.includes(itemName)) ch.checked = false;
			});
		}

		updatePrices();
	};

	// ─── BUILD ADDONS UI ──────────────────────────────────────────

	const buildAddonsUI = () => {
		const container = document.getElementById("modules-container");
		const vertical = document.getElementById("vertical").value;

		updateCoreLabels();

		container.innerHTML = `<p class="text-muted">Loading...</p>`;

		frappe.call({
			method: "sales_quotation.sales_quotation.page.sales_offer.sales_offer.get_plan_items",
			args: { vertical: vertical },
			callback: function (r) {
				container.innerHTML = "";

				if (!r.message || Object.keys(r.message).length === 0) {
					container.innerHTML = `<p class="text-muted">No items found for this vertical.</p>`;
					return;
				}

				const row = document.createElement("div");
				row.className = "row";

				for (const [group, items] of Object.entries(r.message)) {
					const col = document.createElement("div");
					col.className = "col-md-6";
					col.style.marginBottom = "24px";

					const heading = document.createElement("h4");
					heading.textContent = group;
					heading.style.cssText = `
						font-weight: 700;
						margin: 0 0 12px 0;
						padding-bottom: 6px;
						border-bottom: 2px solid #ccc;
					`;
					col.appendChild(heading);

					const groupWrapper = document.createElement("div");
					groupWrapper.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;

					items.forEach((item) => {
						const card = document.createElement("label");
						card.style.cssText = `
							display: flex;
							align-items: flex-start;
							gap: 10px;
							background: #ffffc8;
							border: 1px solid #e0df90;
							border-radius: 5px;
							padding: 10px 14px;
							cursor: pointer;
							margin: 0;
							width: 100%;
							position: relative;
						`;

						// ── Plan badge ─────────────────────────────────────────
						const planLevel = (item.custom_plan_level || "base").toLowerCase();
						const badge = document.createElement("span");
						badge.textContent = planLevel === "elite" ? "Elite" : "Base";
						badge.style.cssText = `
							position: absolute;
							top: 8px;
							right: 10px;
							font-size: 10px;
							font-weight: 700;
							padding: 2px 7px;
							border-radius: 20px;
							text-transform: uppercase;
							letter-spacing: 0.05em;
							background: ${planLevel === "elite" ? "#7c3aed" : "#2563eb"};
							color: #fff;
						`;

						const checkbox = document.createElement("input");
						checkbox.type = "checkbox";
						checkbox.className = "addonCheck";
						checkbox.value = item.name;
						checkbox.dataset.monthly = item.custom_monthly_minimum_usd || 0;
						checkbox.dataset.annual = item.custom_annual_minimum_usd || 0;
						checkbox.dataset.deps = item.custom_dependent_modules || "";
						checkbox.dataset.plan = planLevel;
						checkbox.style.marginTop = "3px";
						checkbox.style.flexShrink = "0";
						checkbox.style.width = "16px";
						checkbox.style.height = "16px";
						checkbox.addEventListener("change", () => handleDependencies(checkbox));

						const details = document.createElement("div");
						details.style.paddingRight = "48px";

						const title = document.createElement("div");
						title.style.fontWeight = "600";
						title.textContent = item.item_name || item.name;

						const meta = document.createElement("div");
						meta.style.cssText = "color: #555; font-size: 12px; margin-top: 4px;";

						const parts = [];
						parts.push(
							item.custom_dependent_modules
								? `Dependencies: ${item.custom_dependent_modules}`
								: "No dependencies",
						);
						if (item.item_prices && item.item_prices.length > 0) {
							item.item_prices.forEach((p) => {
								parts.push(
									`${p.price_list}: ${parseFloat(p.price_list_rate).toFixed(2)} USD`,
								);
							});
						}
						if (item.custom_monthly_minimum_usd && item.custom_annual_minimum_usd) {
							parts.push(
								`Minimum commitment (monthly/annual): ${parseFloat(item.custom_monthly_minimum_usd).toFixed(2)}/${parseFloat(item.custom_annual_minimum_usd).toFixed(2)} USD`,
							);
						}

						meta.textContent = parts.join(" · ");

						details.appendChild(title);
						details.appendChild(meta);
						card.appendChild(checkbox);
						card.appendChild(details);
						groupWrapper.appendChild(card);
					});

					col.appendChild(groupWrapper);
					row.appendChild(col);
				}

				container.appendChild(row);
				updatePrices();
			},
			error: function (err) {
				console.error(err);
				container.innerHTML = `<p class="text-danger">Failed to load items.</p>`;
			},
		});
	};

	// ─── INJECT HTML ──────────────────────────────────────────────

	$(page.body).html(`
		<div class="pricing-calculator-wrapper">
			<div class="pricing-container">
				<h1 class="pricing-title">
					nextech <span class="brand-text" id="vertical-title">.DinePro</span> Pricing Calculator
				</h1>
				<p class="pricing-subtitle">
					Calculator is generated from the provided XLSX pricing matrix.
				</p>

				<div class="pricing-controls">
					<label>
						Vertical:
						<select id="vertical">
							<option value="DinePro">DinePro</option>
							<option value="StayPro">StayPro</option>
						</select>
					</label>
					<label>
						Currency:
						<select id="currency">
							<option value="USD">USD</option>
							<option value="AZN">AZN</option>
						</select>
					</label>
					<label>
						USD→AZN Rate: <span id="fx-display" style="font-weight:600; margin-left:0.5rem;">—</span>
					</label>
				</div>

				<div class="pricing-card">
					<h2 class="card-title" id="core-card-title">Core (POS Terminals)</h2>
					<label for="terminals" id="terminals-question" style="display: block; font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">
						How many POS terminals do you need?
					</label>
					<div class="terminal-controls">
						<input type="range" id="terminals" min="0" max="100" value="0" step="1" />
						<input type="number" id="terminalsInput" min="0" max="100" value="0" step="1" />
					</div>
					<div class="terminal-info">
						<div><span id="included-label">Included (depends on plan &amp; billing):</span> <span id="includedTerminals" class="highlight"></span></div>
						<div><span id="billable-label">Additional terminals billed:</span> <span id="billableTerminals" class="highlight"></span></div>
						<div style="margin-top: 0.5rem;">Core price: <span id="corePrice" class="highlight"></span> <span id="cur1">USD</span> / <span id="billing-period-core">month</span></div>
					</div>
				</div>

				<p class="total-price">
					Total: <span id="totalPrice">0</span> <span id="cur2">USD</span> / <span id="billing-period-total">month</span>
				</p>
				<p class="price-reason" id="price-reason"></p>
				<p style="text-align:center; margin-top:1rem; margin-bottom:1.5rem; font-size:1rem; font-weight:600;">
					Plan: <span id="plan-display" style="padding: 2px 10px; border-radius: 20px; color:#fff; background:#2563eb;">Base</span>
				</p>

				<div class="pricing-card" style="margin-bottom: 1.5rem;">
					<div class="row">
						<div class="col-md-6">
							<div id="customer-field-wrapper"></div>
						</div>
						<div class="col-md-6" style="display: flex; align-items: flex-start; justify-content: end;">
							<div>
								<div class="pricing-controls">
									<label>
										Billing:
										<select id="billing">
											<option value="monthly">Monthly</option>
											<option value="annual">Annual (billed annually)</option>
										</select>
									</label>
								</div>
								<div style="width:100%;display:flex;justify-content:end;">
									<button id="submit-quotation-btn" class="btn btn-primary" style="width: 70%;">
										Submit Quotation
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div id="modules-container" style="max-width: 100%; margin-top: 20px;"></div>

			</div>
		</div>
	`);

	// ─── CUSTOMER FIELD (after HTML is in DOM) ────────────────────

	const customerField = frappe.ui.form.make_control({
		parent: document.getElementById("customer-field-wrapper"),
		df: {
			fieldtype: "Link",
			fieldname: "customer",
			options: "Customer",
			placeholder: "Search customer...",
			label: "Customer",
		},
		render_input: true,
	});
	customerField.refresh();

	// ─── ATTACH EVENTS ────────────────────────────────────────────

	document.getElementById("vertical").addEventListener("change", () => {
		buildAddonsUI();
		updatePrices();
	});
	document.getElementById("billing").addEventListener("change", updatePrices);
	document.getElementById("currency").addEventListener("change", () => {
		fetchExchangeRate(updatePrices);
	});
	document
		.getElementById("terminals")
		.addEventListener("input", (e) => syncTerminals(e.target.value));
	document
		.getElementById("terminalsInput")
		.addEventListener("input", (e) => syncTerminals(e.target.value));

	document.getElementById("submit-quotation-btn").addEventListener("click", () => {
		const customer = customerField.get_value();

		if (!customer) {
			frappe.msgprint("Please select a customer.");
			return;
		}

		const billing = document.getElementById("billing").value;
		const plan = getDetectedPlan();
		const checkedItemNames = getCheckedItemNames();
		const fx_rate = window._fxRate || 1;
		const currency = document.getElementById("currency").value;
		const vertical = document.getElementById("vertical").value;
		const terminals = parseInt(document.getElementById("terminals").value) || 0;

		frappe.call({
			method: "sales_quotation.sales_quotation.page.sales_offer.sales_offer.create_quotation",
			args: {
				fx_rate: fx_rate,
				currency: currency,
				vertical: vertical,
				plan: plan,
				customer: customer,
				item_names: JSON.stringify(checkedItemNames),
				billing: billing,
				terminals: terminals,
			},
			callback: function (r) {
				if (r.message) {
					frappe.show_alert({
						message: `Quotation ${r.message} created!`,
						indicator: "green",
					});
					frappe.set_route("Form", "Quotation", r.message);
				}
			},
			error: function (err) {
				console.error(err);
				frappe.msgprint("Failed to create quotation.");
			},
		});
	});

	// ─── INIT (load settings → fetch rate → build UI) ─────────────

	frappe.call({
		method: "frappe.client.get",
		args: {
			doctype: "Sales Offer Settings",
			name: "Sales Offer Settings",
		},
		callback: function (r) {
			if (r.message) {
				offerSettings.dinepro_core_monthly_price =
					parseFloat(r.message.dinepro_core_monthly_price) || 0;
				offerSettings.dinepro_core_annual_price =
					parseFloat(r.message.dinepro_core_annual_price) || 0;
				offerSettings.staypro_core_monthly_price =
					parseFloat(r.message.staypro_core_monthly_price) || 0;
				offerSettings.staypro_core_annual_price =
					parseFloat(r.message.staypro_core_annual_price) || 0;
				offerSettings.base_pos_terminals = parseInt(r.message.base_pos_terminals) || 0;
				offerSettings.base_pos_terminals_price = parseFloat(r.message.base_pos_terminals_price) || 0;
				offerSettings.elite_pos_terminals = parseInt(r.message.elite_pos_terminals) || 0;
				offerSettings.elite_pos_terminals_price = parseFloat(r.message.elite_pos_terminals_price) || 0;
				offerSettings.base_rooms = parseInt(r.message.base_rooms) || 0;
				offerSettings.base_rooms_price = parseFloat(r.message.base_rooms_price) || 0;
				offerSettings.elite_rooms = parseInt(r.message.elite_rooms) || 0;
					offerSettings.elite_rooms_price = parseFloat(r.message.elite_rooms_price) || 0;
					offerSettings.base_rooms_price_annual = parseFloat(r.message.base_rooms_price_annual) || 0;
					offerSettings.elite_rooms_price_annual = parseFloat(r.message.elite_rooms_price_annual) || 0;
					offerSettings.base_pos_terminals_price_annual = parseFloat(r.message.base_pos_terminals_price_annual) || 0;
					offerSettings.elite_pos_terminals_price_annual = parseFloat(r.message.elite_pos_terminals_price_annual) || 0;
			}
			fetchExchangeRate(() => {
				buildAddonsUI();
				syncTerminals(0);
			});
		},
		error: function (err) {
			console.error("Failed to load Sales Offer Settings:", err);
			fetchExchangeRate(() => {
				buildAddonsUI();
				syncTerminals(0);
			});
		},
	});
};