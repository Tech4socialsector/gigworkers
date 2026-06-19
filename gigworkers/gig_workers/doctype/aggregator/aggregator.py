# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import re
import hashlib
from datetime import datetime
import frappe
from frappe.model.document import Document
from frappe.utils.password import update_password


class Aggregator(Document):
	def validate(self):
		# Email uniqueness across Aggregator and Gig Worker
		if self.email:
			existing_aggregator = frappe.db.get_value(
				"Aggregator", {"email": self.email, "name": ("!=", self.name)}, "name"
			)
			if existing_aggregator:
				frappe.throw(f"Email '{self.email}' is already registered with another Aggregator.")

			existing_worker = frappe.db.get_value(
				"Gig Worker", {"email": self.email}, "name"
			)
			if existing_worker:
				frappe.throw(f"Email '{self.email}' is already registered as a Gig Worker.")

		# Mobile: 10-digit Indian number starting with 6-9
		if self.mobile:
			if not re.match(r'^[6-9][0-9]{9}$', self.mobile):
				frappe.throw("Invalid Mobile Number. Please enter a valid 10-digit Indian mobile number.")

		# Validate PAN at parent level
		if self.pan_number:
			self.pan_number = self.pan_number.upper()
			if not re.match(r'^[A-Z]{5}[0-9]{4}[A-Z]{1}$', self.pan_number):
				frappe.throw("Invalid PAN Format. Should be like ABCDE1234F.")

		# Validate GSTIN at parent level
		if self.gstin:
			self.gstin = self.gstin.upper()
			if not re.match(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$', self.gstin):
				frappe.throw("Invalid GSTIN Format. Should be 15 characters like 22ABCDE1234F1Z5.")

		# Validate Company ID based on Company Type
		if self.company_type and self.company_id:
			if self.company_type == 'CIN':
				if not re.match(r'^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[Pp][Ll][Cc][0-9]{6}$', self.company_id):
					frappe.throw("Invalid CIN Format. Should be like L12345AB2020PLC123456.")
			elif self.company_type == 'LLPIN':
				if not re.match(r'^[A-Z]{3}-[0-9]{4}$', self.company_id.upper()):
					frappe.throw("Invalid LLPIN Format. Should be like AAA-1234.")

	def after_insert(self):
		frappe.db.set_value("Aggregator", self.name, "status", "Submitted")
		self.status = "Submitted"
		self.send_status_email("Submitted")
		self.notify_admins_for_approval()

	def on_update(self):
		prev = self.get_doc_before_save()
		old_status = prev.status if prev else None

		# Admin-triggered status change (via approval page flag or real status change)
		target_status = self.flags.get("trigger_status_email")
		if not target_status and old_status is not None and old_status != self.status:
			target_status = self.status

		if target_status and target_status in ("Under Process", "Pending with Clarification", "Approved"):
			if target_status in ("Pending with Clarification", "Approved"):
				self.create_user_with_role()
			if target_status == "Approved":
				self._generate_and_send_api_key()
			self.send_status_email(target_status)
			self.notify_admins_on_status_change(target_status)

		# Aggregator submits clarification response → move back to Under Process
		old_clarif = prev.clarification_response if prev else None
		if (self.status == "Pending with Clarification"
				and self.clarification_response
				and old_clarif != self.clarification_response):
			frappe.db.set_value("Aggregator", self.name, "status", "Under Process")
			self.status = "Under Process"
			self.send_status_email("Clarification Submitted")
			self.notify_admins_on_status_change("Clarification Submitted")

	def notify_admins_for_approval(self):
		"""Create a Notification Log entry for all System Managers when a new aggregator registers."""
		admin_users = frappe.get_all(
			"Has Role",
			filters={"role": "System Manager", "parenttype": "User"},
			fields=["parent"],
		)
		for row in admin_users:
			user = row.parent
			if not frappe.db.exists("User", {"name": user, "enabled": 1}):
				continue
			notification = frappe.get_doc({
				"doctype": "Notification Log",
				"subject": f"New Aggregator Registration Pending Approval: {self.aggregator_name}",
				"email_content": (
					f"<p>A new aggregator <b>{self.aggregator_name}</b> ({self.name}) has submitted a registration "
					f"and is awaiting your approval.</p>"
					f"<p>Email: {self.email} | Mobile: {self.mobile}</p>"
					f"<p>Please review and update the status to <b>Under Process</b>, <b>Pending with Clarification</b>, or <b>Approved</b>.</p>"
				),
				"for_user": user,
				"from_user": frappe.session.user or "Administrator",
				"type": "Alert",
				"document_type": "Aggregator",
				"document_name": self.name,
				"read": 0,
			})
			notification.insert(ignore_permissions=True)
			frappe.publish_realtime("notification", {}, user=user, after_commit=True)

	def notify_admins_on_status_change(self, status):
		"""Notify System Managers when aggregator status changes so they stay informed."""
		if status not in ("Under Process", "Approved", "Pending with Clarification", "Clarification Submitted"):
			return
		status_labels = {
			"Under Process": "is now Under Process",
			"Approved": "has been Approved",
			"Pending with Clarification": "is Pending with Clarification",
			"Clarification Submitted": "has submitted clarification and is ready for re-review",
		}
		admin_users = frappe.get_all(
			"Has Role",
			filters={"role": "System Manager", "parenttype": "User"},
			fields=["parent"],
		)
		for row in admin_users:
			user = row.parent
			if not frappe.db.exists("User", {"name": user, "enabled": 1}):
				continue
			notification = frappe.get_doc({
				"doctype": "Notification Log",
				"subject": f"Aggregator {self.aggregator_name} {status_labels[status]}",
				"email_content": (
					f"<p>Aggregator <b>{self.aggregator_name}</b> ({self.name}) status has changed to <b>{status}</b>.</p>"
				),
				"for_user": user,
				"from_user": frappe.session.user or "Administrator",
				"type": "Alert",
				"document_type": "Aggregator",
				"document_name": self.name,
				"read": 0,
			})
			notification.insert(ignore_permissions=True)
			frappe.publish_realtime("notification", {}, user=user, after_commit=True)

	def _generate_and_send_api_key(self):
		"""Generate API key + secret for the aggregator's user account on approval.
		Keys are sent over email and must be used in API calls as per requirements §1.4.3."""
		if not self.email or not frappe.db.exists("User", self.email):
			return

		api_key = frappe.generate_hash(length=15)
		api_secret = frappe.generate_hash(length=15)

		user = frappe.get_doc("User", self.email)
		user.api_key = api_key
		user.api_secret = api_secret
		user.save(ignore_permissions=True)

		# try:
		# 	frappe.sendmail(
		# 		recipients=[self.email],
		# 		sender="nishanthclintona@gmail.com",
		# 		delay=False,
		# 		subject="Your API Credentials – Gig Workers Portal",
		# 		message=f"""
		# 		<p>Dear {self.aggregator_name},</p>
		# 		<p>Your aggregator account is now <b>approved</b>. Use the credentials below for programmatic API access to the portal:</p>
		# 		<table style="border-collapse:collapse;margin-top:12px;font-family:monospace;">
		# 		  <tr><td style="padding:4px 16px 4px 0"><b>API Key</b></td><td>{api_key}</td></tr>
		# 		  <tr><td style="padding:4px 16px 4px 0"><b>API Secret</b></td><td>{api_secret}</td></tr>
		# 		</table>
		# 		<p>Pass these as <code>Authorization: token api_key:api_secret</code> in your request headers.</p>
		# 		<p><b>Keep these credentials secure and do not share them.</b></p>
		# 		<p>Thank you,<br>Gig Workers Welfare Team</p>
		# 		""",
		# 	)
		# except Exception as e:
		# 	frappe.log_error(
		# 		message=f"API key email failed for aggregator {self.name}: {e}",
		# 		title="Aggregator API Key Email Error",
		# 	)

	def _generate_registration_certificate_pdf(self):
		"""Generate a Karnataka Government-styled registration certificate PDF.
		No external URLs are used so the PDF works without internet access."""
		from frappe.utils.pdf import get_pdf

		issue_date = datetime.now().strftime("%d-%m-%Y")
		issue_time = datetime.now().strftime("%H:%M:%S")
		estamp_ref = "KA-GWB-" + hashlib.sha256(self.name.encode()).hexdigest()[:10].upper()

		status_color = {
			"Submitted": "#e67e22",
			"Under Process": "#2980b9",
			"Pending with Clarification": "#f39c12",
			"Approved": "#27ae60",
		}.get(self.status or "", "#e67e22")

		# Karnataka State Emblem (Ganda Bherunda) as inline SVG — no external dependency
		logo_html = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140" width="65" height="76">
  <!-- Outer decorative ring -->
  <circle cx="60" cy="62" r="56" fill="#fff8f0" stroke="#8B0000" stroke-width="2.5"/>
  <circle cx="60" cy="62" r="50" fill="none" stroke="#c0a020" stroke-width="1"/>
  <!-- Ganda Bherunda body (two-headed eagle) -->
  <!-- Central body -->
  <ellipse cx="60" cy="65" rx="10" ry="14" fill="#8B0000"/>
  <!-- Left wing -->
  <path d="M50,60 C38,50 22,54 18,62 C24,58 36,62 50,68 Z" fill="#8B0000"/>
  <path d="M50,65 C40,60 28,64 22,70 C30,66 42,68 50,72 Z" fill="#a04000"/>
  <!-- Right wing -->
  <path d="M70,60 C82,50 98,54 102,62 C96,58 84,62 70,68 Z" fill="#8B0000"/>
  <path d="M70,65 C80,60 92,64 98,70 C90,66 78,68 70,72 Z" fill="#a04000"/>
  <!-- Left neck and head -->
  <path d="M55,52 C48,44 38,38 36,30 C40,36 46,40 54,46 Z" fill="#8B0000"/>
  <ellipse cx="34" cy="27" rx="7" ry="5.5" fill="#8B0000" transform="rotate(-30,34,27)"/>
  <!-- Left beak -->
  <path d="M28,25 L22,22 L27,28 Z" fill="#c0a020"/>
  <!-- Left eye -->
  <circle cx="33" cy="24" r="1.5" fill="#c0a020"/>
  <!-- Right neck and head -->
  <path d="M65,52 C72,44 82,38 84,30 C80,36 74,40 66,46 Z" fill="#8B0000"/>
  <ellipse cx="86" cy="27" rx="7" ry="5.5" fill="#8B0000" transform="rotate(30,86,27)"/>
  <!-- Right beak -->
  <path d="M92,25 L98,22 L93,28 Z" fill="#c0a020"/>
  <!-- Right eye -->
  <circle cx="87" cy="24" r="1.5" fill="#c0a020"/>
  <!-- Tail feathers -->
  <path d="M52,79 C50,88 46,94 44,98 L52,90 L60,96 L68,90 L76,98 C74,94 70,88 68,79 Z" fill="#8B0000"/>
  <!-- Talons / feet -->
  <path d="M52,79 C46,82 40,86 38,90" stroke="#8B0000" stroke-width="2" fill="none"/>
  <path d="M68,79 C74,82 80,86 82,90" stroke="#8B0000" stroke-width="2" fill="none"/>
  <!-- Crown / shield at centre chest -->
  <polygon points="60,56 55,68 60,65 65,68" fill="#c0a020"/>
  <!-- Bottom text band -->
  <rect x="4" y="110" width="112" height="16" rx="3" fill="#8B0000"/>
  <text x="60" y="122" font-family="serif" font-size="7.5" fill="#fff" text-anchor="middle" font-weight="bold" letter-spacing="0.5">GOVT OF KARNATAKA</text>
</svg>"""

		services_rows = ""
		for idx, svc in enumerate(self.service_category or [], start=1):
			category_name = svc.service_category or "-"
			try:
				if svc.service_category:
					category_doc = frappe.get_doc("Service Category", svc.service_category)
					category_name = category_doc.category_name or svc.service_category
			except Exception:
				pass
			row_bg = "background:#fdf8ec;" if idx % 2 == 0 else ""
			services_rows += f"""<tr style="{row_bg}">
				<td style="padding:5px 8px;border:1px solid #ddd;text-align:center;">{idx}</td>
				<td style="padding:5px 8px;border:1px solid #ddd;">{category_name}</td>
				<td style="padding:5px 8px;border:1px solid #ddd;">{self.aggregator_name or "-"}</td>
				<td style="padding:5px 8px;border:1px solid #ddd;">{self.company_type or "-"}</td>
				<td style="padding:5px 8px;border:1px solid #ddd;">{self.gstin or "-"}</td>
				<td style="padding:5px 8px;border:1px solid #ddd;color:#27ae60;font-weight:bold;">Active</td>
			</tr>"""

		if not services_rows:
			services_rows = '<tr><td colspan="6" style="padding:8px;text-align:center;color:#888;font-style:italic;border:1px solid #ddd;">No service categories registered</td></tr>'

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

  <!-- Government Header -->
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

  <!-- e-Stamp -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #2c5f2e;background:#f0fff0;padding:6px 10px;margin-bottom:8px;">
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

  <!-- Certificate Title -->
  <div style="text-align:center;margin:8px 0 6px;">
    <div style="font-size:15px;text-transform:uppercase;letter-spacing:2px;color:#8B0000;text-decoration:underline;font-weight:bold;">Certificate of Registration</div>
    <div style="font-size:10.5px;color:#444;margin-top:3px;font-style:italic;">Issued under the Karnataka Platform Based Gig Workers Social Security and Welfare Act</div>
  </div>

  <!-- Registration Details -->
  <div class="section-head">Aggregator Registration Details</div>
  <table class="details-table">
    <tr>
      <td class="lbl">Registration ID</td>
      <td class="val"><span class="reg-id">{self.name}</span></td>
      <td class="lbl">Registration Status</td>
      <td class="val"><b style="color:{status_color};">{self.status or "Submitted"}</b></td>
    </tr>
    <tr>
      <td class="lbl">Aggregator / Company Name</td>
      <td class="val">{self.aggregator_name or "-"}</td>
      <td class="lbl">Registration Date</td>
      <td class="val">{issue_date}</td>
    </tr>
    <tr>
      <td class="lbl">Authorised Person</td>
      <td class="val">{self.name1 or "-"}</td>
      <td class="lbl">Designation</td>
      <td class="val">{self.desigination or "-"}</td>
    </tr>
    <tr>
      <td class="lbl">Registered Email</td>
      <td class="val">{self.email or "-"}</td>
      <td class="lbl">Mobile Number</td>
      <td class="val">{self.mobile or "-"}</td>
    </tr>
    <tr>
      <td class="lbl">Company Type</td>
      <td class="val">{self.company_type or "-"}</td>
      <td class="lbl">Company ID / CIN</td>
      <td class="val">{self.company_id or self.cin_number or "-"}</td>
    </tr>
    <tr>
      <td class="lbl">PAN Number</td>
      <td class="val">{self.pan_number or "-"}</td>
      <td class="lbl">GSTIN</td>
      <td class="val">{self.gstin or "-"}</td>
    </tr>
    <tr>
      <td class="lbl">Website / App URL</td>
      <td class="val">{self.website_url or self.app_url or "-"}</td>
      <td class="lbl">&nbsp;</td>
      <td class="val">&nbsp;</td>
    </tr>
    <tr>
      <td class="lbl" style="vertical-align:top;">Registered Address</td>
      <td class="val" colspan="3">{self.registered_address or "-"}</td>
    </tr>
  </table>

  <!-- Service Categories -->
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

  <!-- Declaration -->
  <div class="declaration">
    This is to certify that <b>{self.aggregator_name}</b> (Registration ID: <b>{self.name}</b>) has been duly
    registered as an Aggregator under the <i>Karnataka Platform Based Gig Workers Social Security and Welfare Act</i>.
    This certificate is system-generated and digitally authenticated by the Karnataka Gig Workers Welfare Board.
    Any tampering with this document is a punishable offence under applicable law.
    This certificate remains valid subject to continued compliance with the Act and Board regulations.
  </div>

  <!-- Signature Row using plain table -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
    <tr>
      <td width="50%" align="center" style="font-size:10.5px;">
        <div style="border-top:1px solid #333;width:150px;margin:34px auto 4px;"></div>
        <div>Authorised Signatory</div>
        <div style="color:#555;">{self.name1 or "Authorised Person"}</div>
      </td>
      <td width="50%" align="center" style="font-size:10.5px;">
        <div style="border-top:1px solid #333;width:150px;margin:34px auto 4px;"></div>
        <div>Registering Authority</div>
        <div style="color:#555;">Karnataka Gig Workers Welfare Board</div>
      </td>
    </tr>
  </table>

  <!-- Footer -->
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

		try:
			return get_pdf(html, {
				"orientation": "Portrait",
				"margin-top": "5",
				"margin-bottom": "5",
				"margin-left": "5",
				"margin-right": "5",
				"page-size": "A4",
			})
		except Exception as e:
			frappe.log_error(f"PDF generation failed for {self.name}: {e}", "Aggregator Certificate PDF Error")
			return None

	def send_status_email(self, status):
		if not self.email:
			return

		base_url  = frappe.utils.get_url()
		login_url = f"{base_url}/login"

		status_messages = {
			"Submitted": {
				"subject": f"[{self.name}] Application Submitted – Karnataka Gig Workers Welfare Board",
				"body": f"""
				<p>Dear <b>{self.aggregator_name}</b>,</p>
				<p>Your aggregator registration application has been successfully <b>submitted</b> to the
				Karnataka Platform Based Gig Workers Social Security and Welfare Board.</p>
				<table style="border-collapse:collapse;margin:12px 0;font-size:13px;">
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Registration ID</b></td><td><b style="color:#8B0000;">{self.name}</b></td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Applicant</b></td><td>{self.aggregator_name}</td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Status</b></td><td><b>Submitted – Awaiting Admin Approval</b></td></tr>
				</table>
				<p>Your <b>Registration Certificate</b> is attached to this email for your records.
				You will be notified once your application is reviewed.</p>
				<p>Thank you,<br><b>Karnataka Gig Workers Welfare Board</b></p>
				"""
			},
			"Under Process": {
				"subject": f"[{self.name}] Application Under Process – Karnataka Gig Workers Welfare Board",
				"body": f"""
				<p>Dear <b>{self.aggregator_name}</b>,</p>
				<p>Your aggregator application (ID: <b>{self.name}</b>) is currently <b>under process</b>.</p>
				<p>Our admin team is reviewing your details. You will be notified once a decision is made.</p>
				<p>Thank you,<br><b>Karnataka Gig Workers Welfare Board</b></p>
				"""
			},
			"Approved": {
				"subject": f"[{self.name}] Application Approved – Karnataka Gig Workers Welfare Board",
				"body": f"""
				<p>Dear <b>{self.aggregator_name}</b>,</p>
				<p>We are pleased to inform you that your aggregator application has been <b>approved</b>
				by the Karnataka Platform Based Gig Workers Social Security and Welfare Board.</p>
				<table style="border-collapse:collapse;margin:12px 0;font-size:13px;">
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Registration ID</b></td><td><b style="color:#8B0000;">{self.name}</b></td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Login URL</b></td><td><a href="{login_url}">{login_url}</a></td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Username</b></td><td>{self.email}</td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Password</b></td><td>Your registered mobile number</td></tr>
				</table>
				<p>Your official <b>Registration Certificate</b> is attached. Please log in and change your password immediately.</p>
				<p>Thank you,<br><b>Karnataka Gig Workers Welfare Board</b></p>
				"""
			},
			"Pending with Clarification": {
				"subject": f"[{self.name}] Clarification Required – Karnataka Gig Workers Welfare Board",
				"body": f"""
				<p>Dear <b>{self.aggregator_name}</b>,</p>
				<p>Your aggregator application (ID: <b>{self.name}</b>) requires <b>clarification</b> before it can be processed further.</p>
				<p><b>Admin Comments:</b></p>
				<blockquote style="border-left:4px solid #f39c12;padding:8px 16px;margin:12px 0;background:#fffbf0;color:#555;">
					{self.clarification_comments or "Please log in to the portal to view the clarification details."}
				</blockquote>
				<p>Please log in to the portal, review the comments, and submit your clarification at the earliest.</p>
				<table style="border-collapse:collapse;margin:12px 0;font-size:13px;">
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Login URL</b></td><td><a href="{login_url}">{login_url}</a></td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Username</b></td><td>{self.email}</td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Password</b></td><td>Your registered mobile number</td></tr>
				</table>
				<p>Thank you,<br><b>Karnataka Gig Workers Welfare Board</b></p>
				"""
			},
			"Clarification Submitted": {
				"subject": f"[{self.name}] Clarification Submitted – Karnataka Gig Workers Welfare Board",
				"body": f"""
				<p>Dear <b>{self.aggregator_name}</b>,</p>
				<p>Thank you for submitting your clarification for application ID: <b>{self.name}</b>.</p>
				<p>Your application is now back <b>Under Process</b> and our team will review your response shortly.
				You will be notified once a decision is made.</p>
				<p>Thank you,<br><b>Karnataka Gig Workers Welfare Board</b></p>
				"""
			},
		}

		if status not in status_messages:
			return

		attachments = []
		if status in ("Submitted", "Approved"):
			pdf = self._generate_registration_certificate_pdf()
			if pdf:
				attachments.append({
					"fname": f"Registration_Certificate_{self.name}.pdf",
					"fcontent": pdf,
				})

		try:
			frappe.sendmail(
				recipients=[self.email],
				subject=status_messages[status]["subject"],
				message=status_messages[status]["body"],
				attachments=attachments,
				now=True,
			)
		except Exception as e:
			frappe.log_error(
				message=f"Status email failed for aggregator {self.name}: {e}",
				title="Aggregator Status Email Error",
			)
			frappe.msgprint(
				f"Warning: Email could not be sent to {self.email}. Please check the Error Log for details.",
				alert=True,
				indicator="orange",
			)

	def create_user_with_role(self):
		if not self.email or not self.mobile:
			return

		if not frappe.db.exists("User", self.email):
			user = frappe.get_doc({
				"doctype": "User",
				"email": self.email,
				"first_name": self.aggregator_name,
				"send_welcome_email": 0,
				"roles": [{"role": "Aggregator"}],
			})
			user.flags.ignore_password_policy = True
			user.insert(ignore_permissions=True)
		else:
			user = frappe.get_doc("User", self.email)
			existing_roles = [r.role for r in user.roles]
			if "Aggregator" not in existing_roles:
				user.append("roles", {"role": "Aggregator"})
				user.save(ignore_permissions=True)

		update_password(self.email, self.mobile)
