"""Run with: cd /home/nishanth/gigworker_V16 && bench --site gigworker.local execute generate_sample_cert.generate"""

import hashlib
from datetime import datetime


def generate():
    import frappe
    from frappe.utils.pdf import get_pdf

    issue_date = datetime.now().strftime("%d-%m-%Y")
    issue_time = datetime.now().strftime("%H:%M:%S")
    name       = "AG001"
    estamp_ref = "KA-GWB-" + hashlib.sha256(name.encode()).hexdigest()[:10].upper()
    status_color = "#27ae60"

    # Karnataka State Emblem (Ganda Bherunda) as inline SVG — no external dependency
    logo_html = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140" width="65" height="76">
  <circle cx="60" cy="62" r="56" fill="#fff8f0" stroke="#8B0000" stroke-width="2.5"/>
  <circle cx="60" cy="62" r="50" fill="none" stroke="#c0a020" stroke-width="1"/>
  <ellipse cx="60" cy="65" rx="10" ry="14" fill="#8B0000"/>
  <path d="M50,60 C38,50 22,54 18,62 C24,58 36,62 50,68 Z" fill="#8B0000"/>
  <path d="M50,65 C40,60 28,64 22,70 C30,66 42,68 50,72 Z" fill="#a04000"/>
  <path d="M70,60 C82,50 98,54 102,62 C96,58 84,62 70,68 Z" fill="#8B0000"/>
  <path d="M70,65 C80,60 92,64 98,70 C90,66 78,68 70,72 Z" fill="#a04000"/>
  <path d="M55,52 C48,44 38,38 36,30 C40,36 46,40 54,46 Z" fill="#8B0000"/>
  <ellipse cx="34" cy="27" rx="7" ry="5.5" fill="#8B0000" transform="rotate(-30,34,27)"/>
  <path d="M28,25 L22,22 L27,28 Z" fill="#c0a020"/>
  <circle cx="33" cy="24" r="1.5" fill="#c0a020"/>
  <path d="M65,52 C72,44 82,38 84,30 C80,36 74,40 66,46 Z" fill="#8B0000"/>
  <ellipse cx="86" cy="27" rx="7" ry="5.5" fill="#8B0000" transform="rotate(30,86,27)"/>
  <path d="M92,25 L98,22 L93,28 Z" fill="#c0a020"/>
  <circle cx="87" cy="24" r="1.5" fill="#c0a020"/>
  <path d="M52,79 C50,88 46,94 44,98 L52,90 L60,96 L68,90 L76,98 C74,94 70,88 68,79 Z" fill="#8B0000"/>
  <path d="M52,79 C46,82 40,86 38,90" stroke="#8B0000" stroke-width="2" fill="none"/>
  <path d="M68,79 C74,82 80,86 82,90" stroke="#8B0000" stroke-width="2" fill="none"/>
  <polygon points="60,56 55,68 60,65 65,68" fill="#c0a020"/>
  <rect x="4" y="110" width="112" height="16" rx="3" fill="#8B0000"/>
  <text x="60" y="122" font-family="serif" font-size="7.5" fill="#fff" text-anchor="middle" font-weight="bold" letter-spacing="0.5">GOVT OF KARNATAKA</text>
</svg>"""

    services_rows = """<tr>
        <td style="padding:5px 8px;border:1px solid #ddd;text-align:center;">1</td>
        <td style="padding:5px 8px;border:1px solid #ddd;">Food Delivery</td>
        <td style="padding:5px 8px;border:1px solid #ddd;">Swiggy</td>
        <td style="padding:5px 8px;border:1px solid #ddd;">CIN</td>
        <td style="padding:5px 8px;border:1px solid #ddd;">29AABCS1429B1Z1</td>
        <td style="padding:5px 8px;border:1px solid #ddd;color:#27ae60;font-weight:bold;">Active</td>
    </tr>
    <tr style="background:#fdf8ec;">
        <td style="padding:5px 8px;border:1px solid #ddd;text-align:center;">2</td>
        <td style="padding:5px 8px;border:1px solid #ddd;">Ride Hailing</td>
        <td style="padding:5px 8px;border:1px solid #ddd;">Swiggy</td>
        <td style="padding:5px 8px;border:1px solid #ddd;">CIN</td>
        <td style="padding:5px 8px;border:1px solid #ddd;">29AABCS1429B1Z1</td>
        <td style="padding:5px 8px;border:1px solid #ddd;color:#27ae60;font-weight:bold;">Active</td>
    </tr>"""

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: "Times New Roman", Times, serif; background: #fff; color: #1a1a1a; font-size: 12px; }}
  .page {{ width: 210mm; min-height: 297mm; padding: 10mm 12mm; position: relative; }}
  .outer-border {{ border: 4px double #8B0000; padding: 8px; position: relative; min-height: 277mm; }}
  .inner-border {{ border: 1.5px solid #c0a020; padding: 12px 16px; position: relative; overflow: hidden; min-height: 269mm; }}
  .watermark {{
    position: absolute; top: 45%; left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 75px; color: rgba(180,180,180,0.12); font-weight: bold;
    white-space: nowrap; z-index: 0; letter-spacing: 4px;
  }}
  .section-head {{
    font-size: 11px; font-weight: bold; color: #fff; background: #8B0000;
    padding: 5px 8px; text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 0 0;
  }}
  .details-table {{ width: 100%; border-collapse: collapse; border: 1px solid #d4b483; }}
  .details-table td {{ padding: 5px 8px; border: 1px solid #d4b483; font-size: 11px; vertical-align: top; }}
  .details-table tr:nth-child(even) td {{ background: #fdf8ec; }}
  .lbl {{ font-weight: bold; color: #555; width: 20%; }}
  .val {{ color: #1a1a1a; width: 30%; }}
  .reg-id {{ font-size: 13px; font-weight: bold; color: #8B0000; font-family: monospace; }}
  .svc-table {{ width: 100%; border-collapse: collapse; font-size: 11px; }}
  .svc-table th {{ background: #4a4a4a; color: #fff; padding: 5px 8px; text-align: left; border: 1px solid #4a4a4a; }}
  .declaration {{ background: #fff8f0; border-left: 4px solid #8B0000; padding: 8px 10px; font-size: 10.5px; color: #444; line-height: 1.6; margin-top: 8px; }}
  .footer {{ text-align: center; font-size: 9px; color: #777; border-top: 1px solid #ccc; padding-top: 6px; margin-top: 8px; }}
</style>
</head>
<body>
<div class="page">
<div class="outer-border">
<div class="inner-border">
  <div class="watermark">GOVT OF KARNATAKA</div>

  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid #8B0000;padding-bottom:8px;margin-bottom:8px;">
    <tr>
      <td width="75" valign="middle" align="center">
        {logo_html}
      </td>
      <td valign="middle" align="center" style="padding:0 10px;">
        <div style="font-size:18px;font-weight:bold;color:#8B0000;">ಕರ್ನಾಟಕ ಸರ್ಕಾರ</div>
        <div style="font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin-top:2px;">Government of Karnataka</div>
        <div style="font-size:10px;color:#333;margin-top:2px;">Department of Labour, Skill Development, Employment and Livelihood</div>
        <div style="font-size:11.5px;font-weight:bold;color:#8B0000;margin-top:3px;">Karnataka Platform Based Gig Workers Social Security and Welfare Board</div>
        <div style="font-size:10px;color:#555;margin-top:2px;">Vikasa Soudha, Bengaluru &#8211; 560 001, Karnataka, India</div>
      </td>
      <td width="80" valign="middle" align="center">
        <div style="border:2px solid #2c5f2e;border-radius:4px;padding:5px 6px;font-size:8px;color:#2c5f2e;font-weight:bold;line-height:1.6;background:#f0fff0;width:70px;text-align:center;">
          &#10003;<br>VERIFIED<br>DOCUMENT
        </div>
      </td>
    </tr>
  </table>

  <table width="100%" cellpadding="6" cellspacing="0" style="border:1.5px solid #2c5f2e;background:#f0fff0;margin-bottom:8px;">
    <tr>
      <td valign="middle">
        <div style="color:#2c5f2e;font-weight:bold;font-size:10.5px;">e-Stamp Reference</div>
        <div style="font-family:monospace;font-size:12px;font-weight:bold;letter-spacing:1px;">{estamp_ref}</div>
      </td>
      <td valign="middle" align="right">
        <div style="color:#2c5f2e;font-weight:bold;font-size:10.5px;">Date of Issue</div>
        <div style="color:#555;font-size:10px;">{issue_date} at {issue_time} IST</div>
        <div style="color:#555;font-size:10px;">State: Karnataka &nbsp;|&nbsp; Category: Aggregator Registration</div>
      </td>
    </tr>
  </table>

  <div style="text-align:center;margin:8px 0 6px;">
    <div style="font-size:15px;text-transform:uppercase;letter-spacing:2px;color:#8B0000;text-decoration:underline;font-weight:bold;">Certificate of Registration</div>
    <div style="font-size:10.5px;color:#444;margin-top:3px;font-style:italic;">Issued under the Karnataka Platform Based Gig Workers Social Security and Welfare Act</div>
  </div>

  <div class="section-head">Aggregator Registration Details</div>
  <table class="details-table">
    <tr>
      <td class="lbl">Registration ID</td>
      <td class="val"><span class="reg-id">AG001</span></td>
      <td class="lbl">Registration Status</td>
      <td class="val"><b style="color:{status_color};">Approved</b></td>
    </tr>
    <tr>
      <td class="lbl">Aggregator / Company Name</td>
      <td class="val">Swiggy</td>
      <td class="lbl">Registration Date</td>
      <td class="val">{issue_date}</td>
    </tr>
    <tr>
      <td class="lbl">Authorised Person</td>
      <td class="val">Rajesh Kumar</td>
      <td class="lbl">Designation</td>
      <td class="val">CEO</td>
    </tr>
    <tr>
      <td class="lbl">Registered Email</td>
      <td class="val">rajesh@swiggy.com</td>
      <td class="lbl">Mobile Number</td>
      <td class="val">9876543210</td>
    </tr>
    <tr>
      <td class="lbl">Company Type</td>
      <td class="val">CIN</td>
      <td class="lbl">Company ID / CIN</td>
      <td class="val">U74999KA2014PTC074088</td>
    </tr>
    <tr>
      <td class="lbl">PAN Number</td>
      <td class="val">AABCS1429B</td>
      <td class="lbl">GSTIN</td>
      <td class="val">29AABCS1429B1Z1</td>
    </tr>
    <tr>
      <td class="lbl">Website / App URL</td>
      <td class="val">https://swiggy.com</td>
      <td class="lbl">&nbsp;</td>
      <td class="val">&nbsp;</td>
    </tr>
    <tr>
      <td class="lbl" style="vertical-align:top;">Registered Address</td>
      <td class="val" colspan="3">No. 55, Race Course Road, Bengaluru &#8211; 560 001, Karnataka, India</td>
    </tr>
  </table>

  <div class="section-head">Categories of Business / Aggregation Activities (As Per GST Filings)</div>
  <table class="svc-table">
    <thead>
      <tr>
        <th style="width:5%;text-align:center;">#</th>
        <th style="width:20%;">Service Name</th>
        <th style="width:23%;">Brand / App Name</th>
        <th style="width:15%;">Company Type</th>
        <th style="width:20%;">GSTIN</th>
        <th style="width:17%;">Status</th>
      </tr>
    </thead>
    <tbody>{services_rows}</tbody>
  </table>

  <div class="declaration">
    This is to certify that <b>Swiggy</b> (Registration ID: <b>AG001</b>) has been duly
    registered as an Aggregator under the <i>Karnataka Platform Based Gig Workers Social Security and Welfare Act</i>.
    This certificate is system-generated and digitally authenticated by the Karnataka Gig Workers Welfare Board.
    Any tampering with this document is a punishable offence under applicable law.
    This certificate remains valid subject to continued compliance with the Act and Board regulations.
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
    <tr>
      <td width="50%" align="center" style="font-size:10.5px;">
        <div style="border-top:1px solid #333;width:150px;margin:34px auto 4px;"></div>
        <div>Authorised Signatory</div>
        <div style="color:#555;">Rajesh Kumar</div>
      </td>
      <td width="50%" align="center" style="font-size:10.5px;">
        <div style="border-top:1px solid #333;width:150px;margin:34px auto 4px;"></div>
        <div>Registering Authority</div>
        <div style="color:#555;">Karnataka Gig Workers Welfare Board</div>
      </td>
    </tr>
  </table>

  <div class="footer">
    e-Stamp Ref: {estamp_ref} &nbsp;|&nbsp; Generated: {issue_date} {issue_time} IST &nbsp;|&nbsp;
    Karnataka Gig Workers Welfare Board, Vikasa Soudha, Bengaluru &#8211; 560 001
    <br>Helpline: 1800-XXX-XXXX &nbsp;|&nbsp; Email: support@kgwwb.karnataka.gov.in
  </div>

</div>
</div>
</div>
</body>
</html>"""

    pdf_bytes = get_pdf(html, {
        "orientation": "Portrait",
        "margin-top": "5",
        "margin-bottom": "5",
        "margin-left": "5",
        "margin-right": "5",
        "page-size": "A4",
    })

    output_path = "/home/nishanth/gigworker_V16/sites/gigworker.local/public/files/Sample_Registration_Certificate.pdf"
    with open(output_path, "wb") as f:
        f.write(pdf_bytes)

    print(f"PDF saved to: {output_path}")
    print(f"View at: http://gigworker.local:8003/files/Sample_Registration_Certificate.pdf")
