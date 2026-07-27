export const getInvoiceTemplate = (lead) => {
  // ── 1. Helper: Number to Words ──────────────────────────────────────────
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const toWords = (n) => {
    n = Math.round(n);
    if (n === 0) return 'Zero';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + toWords(n % 100) : '');
    if (n < 100000) return toWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + toWords(n % 1000) : '');
    if (n < 10000000) return toWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + toWords(n % 100000) : '');
    return toWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + toWords(n % 10000000) : '');
  };

  // ── 2. Financial & Date Calculations ─────────────────────────────────────
  let totalPlantCost;
  if (lead.Solar_Panel_Model && lead.Solar_Panel_Model.includes('TopCon')) {
    totalPlantCost = 200000; // 2 Lakhs - TopCon Bifacial 600–620W
  } else if (lead.Solar_Panel_Model && lead.Solar_Panel_Model.includes('Mono PERC')) {
    totalPlantCost = 100000; // 1 Lakh - Mono PERC Half Cut Bifacial 520–550W
  } else {
    totalPlantCost = parseFloat(lead.Total_Plant_Cost || 0); // fallback
  }
  const taxRate = 5; // Fixed 5% GST
  const taxableValue = totalPlantCost / (1 + (taxRate / 100));
  const totalTax = totalPlantCost - taxableValue;
  const halfTax = totalTax / 2;

  const amountInWords = toWords(Math.round(totalPlantCost)) + ' Rupees Only';

  // Payment Due Date: 2 days after today
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 2);
  const formattedDueDate = lead.Due_Date || dueDate.toLocaleDateString('en-IN');

  // ── 3. Render Item Row (Synthesized from Technical Specs) ───────────────
  const itemDescription = `
    Solar PV Power Plant Installation: ${lead.Inverter_Capacity || 'N/A'} kWp 
    (${lead.Solar_Panel_Brand || 'Standard'} Panels x ${lead.No_of_Panels || 0} Nos) 
    Inverter: ${lead.Inverter_Brand || 'N/A'} ${lead.Inverter_Capacity || 'N/A'}
  `.trim();

  const itemRows = `
    <tr>
      <td style="text-align:center">1</td>
      <td>
        <strong>${itemDescription}</strong><br>
        <small style="color:#555;">Structure: ${lead.Structure_Type || 'N/A'} | Roof: ${lead.Roof_Type || 'N/A'}</small>
      </td>
      <td style="text-align:center">8541</td>
      <td style="text-align:center">5%</td>
      <td style="text-align:center">1 Set</td>
      <td style="text-align:right">₹${taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td style="text-align:right">₹${taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>
  `;

  // ── 4. Final HTML Construction ──────────────────────────────────────────
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #f5f5f5; }
  .invoice { max-width: 900px; margin: 30px auto; padding: 24px; border: 1px solid #ccc; background: #fff; color: #222; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #ddd; }
  .company-name { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
  .company-sub { font-size: 12px; color: #555; line-height: 1.7; }
  .address-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .box { border: 0.5px solid #ccc; padding: 10px; border-radius: 6px; }
  .box-title { font-size: 11px; font-weight: bold; color: #666; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
  .field { font-size: 12px; line-height: 1.5; color: #222; }
  .kv { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
  .kv-label { color: #666; }
  table.items { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; }
  table.items th { background: #f0f0f0; padding: 7px 8px; text-align: left; font-weight: bold; border: 0.5px solid #ccc; }
  table.items td { padding: 7px 8px; border: 0.5px solid #ccc; vertical-align: top; }
  .totals-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .totals-table { width: 100%; font-size: 12px; border-collapse: collapse; }
  .totals-table td { padding: 4px 6px; }
  .totals-table tr.grand td { font-weight: bold; font-size: 13px; border-top: 1px solid #aaa; padding-top: 6px; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 16px; padding-top: 12px; border-top: 0.5px solid #ccc; font-size: 12px; }
</style>
</head>
<body>
<div class="invoice">
  <div class="header">
    <div>
      <div class="company-name" style="color:#cc0000;font-size:26px;">Kondaas</div>
      <div class="company-name">Kondaas Automation Pvt Ltd</div>
      <div class="company-sub">
        Registered Office: 5B, Sri Alamelu Nagar, Kamarajar Road, Coimbatore, 641015<br>
        GSTIN: 33AAACK7337F1ZR | State: Tamil Nadu
      </div>
    </div>
    <div style="text-align:right"><div style="font-size:11px; color:#777;">Original For Recipient</div></div>
  </div>

  <div class="address-row">
    <div class="box">
      <div class="box-title">Billing Address</div>
      <div class="field">
        <strong>V.S.CHANDRASEKARAN</strong><br>
        No;32 , Subramaniam Road ,, Rs Puram, , Coimbatore, Tamil Nadu, 641002 India<br>
        Mobile: 9940673850
      </div>
    </div>
    <div class="box">
      <div class="box-title">Delivery Address</div>
      <div class="field">
        <strong>${lead.Consumer_Name || 'N/A'}</strong><br>
        ${lead.Street_Address || 'N/A'}, ${lead.City || 'N/A'}, ${lead.State_Province || 'N/A'} - ${lead.Zip_Postal_Code || ''}<br>
        Mobile: ${lead.Mobile || 'N/A'}
      </div>
    </div>
    <div class="box">
      <div class="box-title">Invoice Details</div>
      <div class="kv"><span class="kv-label">Consumer No</span> <span>${lead.Consumer_Number || 'N/A'}</span></div>
      <div class="kv"><span class="kv-label">Invoice No</span> <span>${lead.Report_Number || 'PENDING'}</span></div>
      <div class="kv"><span class="kv-label">Invoice Date</span> <span>${lead.Site_Survey_Requested_Date_Time || new Date().toLocaleDateString('en-IN')}</span></div>
      <div class="kv"><span class="kv-label">Due Date</span> <span>${formattedDueDate}</span></div>
      <div class="kv"><span class="kv-label">Surveyor</span> <span>${lead.Assigned_To || 'N/A'}</span></div>
      <div class="kv"><span class="kv-label">Surveyor Contact</span> <span>${lead.Site_Engineer_Contact || 'N/A'}</span></div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:32px">No</th>
        <th>Description</th>
        <th style="width:70px">HSN</th>
        <th style="width:40px">Tax</th>
        <th style="width:60px">Qty</th>
        <th style="width:90px">Rate</th>
        <th style="width:90px">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="totals-row">
    <div>
      <div class="box" style="margin-bottom:10px">
        <div class="box-title">Amount in Words</div>
        <div class="field" style="font-weight:bold;">${amountInWords}</div>
      </div>
      <div class="box">
        <div class="box-title">Bank Details</div>
        <div class="field">TMB | A/c: 016700150950340 | IFSC: TMBL0000016</div>
      </div>
    </div>
    <div>
      <table class="totals-table">
        <tr><td>Taxable Value</td><td style="text-align:right">₹${taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
        <tr><td>SGST (2.5%)</td><td style="text-align:right">₹${halfTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
        <tr><td>CGST (2.5%)</td><td style="text-align:right">₹${halfTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
        <tr class="grand"><td>Grand Total</td><td style="text-align:right">₹${totalPlantCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
      </table>
    </div>
  </div>

  <div class="sig-row">
    <div class="sig-box"><div style="font-size:12px;color:#666">QR Code Pay</div></div>
    <div class="sig-box"><div style="font-size:12px;color:#666">For Kondaas Automation Pvt Ltd</div><div style="border-top:1px solid #aaa;margin-top:40px;padding-top:4px;">Authorized Signatory</div></div>
  </div>
</div>
</body>
</html>`;
};


// RAW survey form data 
export const getSurveyReportTemplate = (formData) => {
  const d = formData || {};

  const displayDate = d.Site_survey_Completed_Date_Time
    ? new Date(d.Site_survey_Completed_Date_Time).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const displayTime = d.Site_survey_Completed_Date_Time
    ? new Date(d.Site_survey_Completed_Date_Time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  const reportNumber = d.Report_Number || 'N/A';

  const getStatusBadge = (val) => {
    const cleanStr = String(val || '').trim().toLowerCase();
    if (cleanStr === 'collected' || cleanStr === 'yes' || cleanStr === 'required' || val === true) {
      return `<span style="background-color: #e6f4ea; color: #137333; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">${val === true ? 'Yes' : val}</span>`;
    }
    if (cleanStr === 'not collected' || cleanStr === 'no' || cleanStr === 'not required' || val === false) {
      return `<span style="background-color: #fce8e6; color: #c5221f; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">${val === false ? 'No' : val}</span>`;
    }
    return val || 'N/A';
  };

  const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

  const computedNetDue = d.Plant_Cost_After_Subsidy != null
    ? d.Plant_Cost_After_Subsidy
    : (Number(d.Total_Plant_Cost || 0) - Number(d.Subsidy || 0) + Number(d.Additional_EB_Charges || 0) + Number(d.Additional_Structure_Cost || 0));

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Solar Site Survey Report</title>
    <style>
      @page {
        size: A4;
        margin: 15mm 15mm 20mm 15mm;
      }
      body {
        font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
        color: #333;
        margin: 0;
        padding: 0;
        font-size: 12px;
        line-height: 1.4;
        background-color: #fff;
      }
      .header-container {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        border-bottom: 3px solid #e31e24;
        padding-bottom: 10px;
        margin-bottom: 20px;
      }
      .brand-title-group h1 {
        color: #e31e24;
        font-size: 24px;
        margin: 0;
        font-weight: 800;
        letter-spacing: 0.5px;
      }
      .brand-title-group p {
        margin: 2px 0 0 0;
        font-size: 11px;
        text-transform: uppercase;
        color: #666;
        letter-spacing: 1px;
        font-weight: 600;
      }
      .pricing-notice {
        font-size: 10px;
        color: #777;
        font-style: italic;
        text-align: right;
        margin-top: 5px;
      }
      .meta-tracker-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
      }
      .meta-tracker-table th {
        background-color: #2c3e50;
        color: #fff;
        font-weight: 600;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 6px 10px;
        border: 1px solid #2c3e50;
        text-align: left;
      }
      .meta-tracker-table td {
        padding: 6px 10px;
        border: 1px solid #ddd;
        font-weight: bold;
        color: #2c3e50;
        background-color: #f8f9fa;
      }
      .section-block {
        margin-bottom: 20px;
        page-break-inside: avoid;
      }
      .section-title {
        background-color: #f1f3f4;
        color: #1a73e8;
        font-size: 12px;
        font-weight: bold;
        padding: 6px 10px;
        margin: 0 0 8px 0;
        border-left: 4px solid #1a73e8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .data-table {
        width: 100%;
        border-collapse: collapse;
      }
      .data-table td {
        padding: 7px 10px;
        border: 1px solid #e0e0e0;
        vertical-align: top;
        width: 25%;
      }
      .data-table td.label {
        font-weight: 600;
        color: #5f6368;
        background-color: #f8f9fa;
        width: 25%;
      }
      .data-table td.value {
        color: #202124;
        width: 25%;
      }
      .pricing-highlight {
        background-color: #f8f9fa;
        border: 1px solid #dadce0;
        padding: 12px;
        border-radius: 4px;
        margin-top: 5px;
      }
      .pricing-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 12px;
      }
      .pricing-row.total {
        border-top: 1px solid #ccc;
        margin-top: 6px;
        padding-top: 6px;
        font-size: 14px;
        font-weight: bold;
        color: #e31e24;
      }
      .signature-container {
        display: flex;
        justify-content: space-between;
        margin-top: 30px;
        page-break-inside: avoid;
      }
      .signature-box {
        width: 45%;
        border-top: 1px dashed #999;
        text-align: center;
        padding-top: 8px;
        font-size: 11px;
        color: #5f6368;
      }
      .sig-space {
        height: 60px;
        font-family: 'Courier New', Courier, monospace;
        font-style: italic;
        font-size: 16px;
        color: #1a73e8;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .footer-note {
        text-align: center;
        font-size: 10px;
        color: #999;
        margin-top: 30px;
        border-top: 1px solid #eee;
        padding-top: 5px;
      }
    </style>
  </head>
  <body>

    <div class="header-container">
      <div class="brand-title-group">
        <h1>KONDAAS</h1>
        <p>Rooftop Solar Site Survey & Technical Report</p>
      </div>
      <div>
        <div style="font-weight: bold; color: #e31e24; font-size: 14px; text-align: right;">OFFICIAL SURVEY REPORT</div>
        <div class="pricing-notice">* Pricing valid for 7 days from survey completion date.</div>
      </div>
    </div>

    <table class="meta-tracker-table">
      <thead>
        <tr>
          <th>Report Number</th>
          <th>Survey Date</th>
          <th>Survey Time</th>
          <th>GPS Link</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${reportNumber}</td>
          <td>${displayDate}</td>
          <td>${displayTime}</td>
          <td><a href="${d.Google_Map_Location || '#'}" style="color: #1a73e8; text-decoration: none;">Click to View Map</a></td>
        </tr>
      </tbody>
    </table>

    <div class="section-block">
      <div class="section-title">1. Customer Contact Details</div>
      <table class="data-table">
        <tr>
          <td class="label">Deal Name</td>
          <td class="value">${d.Deal_Name || 'N/A'}</td>
          <td class="label">Lead Source</td>
          <td class="value">${d.Lead_Source || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Mobile Number</td>
          <td class="value">${d.Mobile_Number || 'N/A'}</td>
          <td class="label">Phone Number</td>
          <td class="value">${d.Phone_Number || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">WhatsApp Number</td>
          <td class="value">${d.WhatsApp_Number || 'N/A'}</td>
          <td class="label">Referred By</td>
          <td class="value">${d.Referred_By || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Site Survey Assigned By</td>
          <td class="value">${d.Site_Survey_Assigned_By || 'N/A'}</td>
          <td class="label">Service Agent's Name</td>
          <td class="value">${d.ServiceAgentName || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Site Engineer Contact</td>
          <td class="value" colspan="3">${d.Site_Engineer_Contact || 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">2. Address Information</div>
      <table class="data-table">
        <tr>
          <td class="label">Country/Region</td>
          <td class="value">${d.Country_Region || 'N/A'}</td>
          <td class="label">State/Province</td>
          <td class="value">${d.State_Province || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">District</td>
          <td class="value">${d.District || 'N/A'}</td>
          <td class="label">Sub District</td>
          <td class="value">${d.Sub_District || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">City</td>
          <td class="value">${d.City || 'N/A'}</td>
          <td class="label">Postal Code</td>
          <td class="value">${d.Zip_Postal_Code || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Street</td>
          <td class="value" colspan="3">${d.Street_Address || 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">3. EB Details</div>
      <table class="data-table">
        <tr>
          <td class="label">EB Connection Under Contact Person</td>
          <td class="value">${d.KSEB_Connection_Under_Contact_Person || 'N/A'}</td>
          <td class="label">Order Type</td>
          <td class="value">${d.Order_Type || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Project Type</td>
          <td class="value">${d.Project_Type || 'N/A'}</td>
          <td class="label">Consumer Name</td>
          <td class="value">${d.Consumer_Name || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Consumer Number</td>
          <td class="value">${d.Consumer_Number || 'N/A'}</td>
          <td class="label">EB Connection Status</td>
          <td class="value">${d.EB_Connection_Status || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Tariff</td>
          <td class="value">${d.Tariff || 'N/A'}</td>
          <td class="label">Connection Type</td>
          <td class="value">${d.Connection_Type || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Connected Load</td>
          <td class="value">${d.Connected_Load ? d.Connected_Load + ' kW' : 'N/A'}</td>
          <td class="label">Balance Transformer Capacity Available</td>
          <td class="value">${d.Balance_Transformer_Capacity || 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">4. Product Information</div>
      <table class="data-table">
        <tr>
          <td class="label">Project Model</td>
          <td class="value">${d.Project_Model || 'N/A'}</td>
          <td class="label">Inverter Connection Type</td>
          <td class="value">${d.Inverter_Connection_Type || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Inverter Capacity</td>
          <td class="value">${d.Inverter_Capacity ? d.Inverter_Capacity + ' kW' : 'N/A'}</td>
          <td class="label">Solar Panel Model</td>
          <td class="value">${d.Solar_Panel_Model || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Solar Panel Brand</td>
          <td class="value">${d.Solar_Panel_Brand || 'N/A'}</td>
          <td class="label">No of Panels</td>
          <td class="value">${d.No_of_Panels || 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">5. Structure Details</div>
      <table class="data-table">
        <tr>
          <td class="label">North to South Space Available (meters)</td>
          <td class="value">${d.North_to_South_Space_Available_in_meters || 'N/A'}</td>
          <td class="label">West to East Space Available (meters)</td>
          <td class="value">${d.West_to_East_Space_Available_meters || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Structure Type</td>
          <td class="value">${d.Structure_Type || 'N/A'}</td>
          <td class="label">Ready Made Structure Fixing Model</td>
          <td class="value">${d.Ready_Made_Structure_Fixing_Model || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Solar Panel Mounting Structure Type</td>
          <td class="value" colspan="3">${d.Solar_Panel_Mounting_Structure_Type || 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">6. Roof & Safety Details</div>
      <table class="data-table">
        <tr>
          <td class="label">Building Height Profile</td>
          <td class="value">${d.Building_Height_Profile || 'N/A'}</td>
          <td class="label">Roof Type</td>
          <td class="value">${d.Roof_Type || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Roof Access Available?</td>
          <td class="value">${getStatusBadge(d.Roof_Access_Available)}</td>
          <td class="label">Roof Surface Physical Condition</td>
          <td class="value">${d.Roof_Surface_Physical_Condition || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Walkway</td>
          <td class="value">${getStatusBadge(d.Walkway)}</td>
          <td class="label">Ladder</td>
          <td class="value">${getStatusBadge(d.Ladder)}</td>
        </tr>
        <tr>
          <td class="label">Required Ladder Length</td>
          <td class="value">${d.Required_Ladder_Length || 'N/A'}</td>
          <td class="label">Sliding Door</td>
          <td class="value">${getStatusBadge(d.Sliding_Door)}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">7. Cable Requirements</div>
      <table class="data-table">
        <tr>
          <td class="label">Cable Requirements</td>
          <td class="value" colspan="3">${d.Cable_Requirements || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">AC Cable</td>
          <td class="value">${d.AC_Cable || 'N/A'}</td>
          <td class="label">DC Cable</td>
          <td class="value">${d.DC_Cable || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Earthing Cable</td>
          <td class="value">${d.Earthing_Cable || 'N/A'}</td>
          <td class="label">LA Cable</td>
          <td class="value">${d.LA_Cable || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">UG Cable</td>
          <td class="value" colspan="3">${d.UG_Cable || 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">8. Shadow Analysis</div>
      <table class="data-table">
        <tr>
          <td class="label">Shadow Possibility</td>
          <td class="value">${getStatusBadge(d.Shadow_Possibility)}</td>
          <td class="label">Consumer Informed About Shadow Possibility</td>
          <td class="value">${getStatusBadge(d.Consumer_Informed_About_Shadow_Possibility)}</td>
        </tr>
        <tr>
          <td class="label">Shadow Analysis Remarks</td>
          <td class="value" colspan="3">${d.Shadow_Analysis_Remarks || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Nearby Tree</td>
          <td class="value">${getStatusBadge(d.Nearby_Tree)}</td>
          <td class="label">High Raised Water Tank</td>
          <td class="value">${getStatusBadge(d.High_Raised_Water_Tank)}</td>
        </tr>
        <tr>
          <td class="label">Stair Room / Lift Room</td>
          <td class="value">${getStatusBadge(d.Stair_Room_Lift_Room)}</td>
          <td class="label">Nearby High Buildings</td>
          <td class="value">${getStatusBadge(d.Nearby_High_Buildings)}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">9. Document Verification</div>
      <table class="data-table">
        <tr>
          <td class="label">Checked Subsidy Eligibility?</td>
          <td class="value">${getStatusBadge(d.Checked_Subsidy_Eligibility)}</td>
          <td class="label">Name Change In EB Bill</td>
          <td class="value">${getStatusBadge(d.Name_Change_In_EB_Bill)}</td>
        </tr>
        <tr>
          <td class="label">Name Change in Bank</td>
          <td class="value">${getStatusBadge(d.Name_Change_in_Bank)}</td>
          <td class="label">Address Update In EB Bill</td>
          <td class="value">${getStatusBadge(d.Address_Update_In_EB_Bill)}</td>
        </tr>
        <tr>
          <td class="label">Address Update in Aadhar</td>
          <td class="value">${getStatusBadge(d.Address_Update_in_Aadhar)}</td>
          <td class="label">Connected Load Revise</td>
          <td class="value">${getStatusBadge(d.Connected_Load_Revise)}</td>
        </tr>
        <tr>
          <td class="label">Tariff Change</td>
          <td class="value" colspan="3">${getStatusBadge(d.Tariff_Change)}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">10. Site Survey Photos</div>
      <div style="border: 1px solid #dadce0; padding: 12px; min-height: 40px; background-color: #fdfdfd; font-size: 11px; white-space: pre-line;">
        ${'No critical installation risks noted at the time of site survey evaluation.'}
      </div>
    </div>

    <div class="section-block">
      <div class="section-title">11. Payment Details</div>
      <table class="data-table">
        <tr>
          <td class="label">Mode of Payment</td>
          <td class="value"><strong>${d.Mode_of_Payment || 'N/A'}</strong></td>
          <td class="label">Advance Payment Collection Status</td>
          <td class="value">${getStatusBadge(d.Advance_Payment_Collection_Status)}</td>
        </tr>
        <tr>
          <td class="label">Advance Paid Date</td>
          <td class="value">${d.Advance_Paid_Date || 'N/A'}</td>
          <td class="label">Advance Amount</td>
          <td class="value">${d.Advanced_Paid != null ? money(d.Advanced_Paid) : 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Advance Payment UTR</td>
          <td class="value" colspan="3">${d.Advance_Payment_UTR || 'N/A'}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">12. Documents Collection Details</div>
      <table class="data-table">
        <tr>
          <td class="label">Documents Collected Status</td>
          <td class="value" colspan="3">${getStatusBadge(d.Documents_Collected_Status)}</td>
        </tr>
      </table>
    </div>

    <div class="section-block">
      <div class="section-title">13. Subsidy & Pricing Information</div>
      <div class="pricing-highlight">
        <div class="pricing-row">
          <span>Total Plant Cost:</span>
          <span>${money(d.Total_Plant_Cost)}</span>
        </div>
        <div class="pricing-row" style="color: #c5221f;">
          <span>Subsidy (-):</span>
          <span>- ${money(d.Subsidy)}</span>
        </div>
        <div class="pricing-row">
          <span>Additional Structure Cost:</span>
          <span>${money(d.Additional_Structure_Cost)}</span>
        </div>
        <div class="pricing-row">
          <span>Additional EB Charges:</span>
          <span>${money(d.Additional_EB_Charges)}</span>
        </div>
        <div class="pricing-row total">
          <span>Plant Cost After Subsidy (Net Due):</span>
          <span>${money(computedNetDue)}</span>
        </div>
      </div>
    </div>

    <div class="signature-container">
      <div class="signature-box">
        <div class="sig-space">
          ${d.Site_Engineer_Signature ? `<img src="${d.Site_Engineer_Signature}" style="max-height: 55px; max-width: 100%;" />` : d.Site_Survey_Assigned_By || 'Authorized Engineer'}
        </div>
        <strong>SITE ENGINEER SIGNATURE</strong><br>
        <span style="font-size: 9px; color:#888;">Date: ${displayDate} | Time: ${displayTime}</span>
      </div>
      <div class="signature-box">
        <div class="sig-space">
          ${d.Customer_Confirmation_Signature ? `<img src="${d.Customer_Confirmation_Signature}" style="max-height: 55px; max-width: 100%;" />` : d.Consumer_Name || 'Authorized Signatory'}
        </div>
        <strong>CUSTOMER CONFIRMATION SIGNATURE</strong><br>
        <span style="font-size: 9px; color:#888;">Kondaas Automation Authorization Signature</span>
      </div>
    </div>

    <div class="footer-note">
      Report Generated Automatically via Kondaas Site Survey Operations Engine. Page 1 of 1
    </div>

  </body>
  </html>
  `;
};
