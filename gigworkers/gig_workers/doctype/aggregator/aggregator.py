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

		# ── Official Karnataka Government Seal embedded as base64 PNG ─────────
		import os as _os, base64 as _b64
		_png_path = _os.path.join(frappe.get_app_path("gigworkers"), "public", "images", "seal_karnataka.png")
		try:
			with open(_png_path, "rb") as _f:
				_b64_data = _b64.b64encode(_f.read()).decode()
			logo_html = f'<img src="data:image/png;base64,{_b64_data}" width="110" height="95" style="display:block;" />'
		except Exception:
			logo_html = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 175" width="92" height="101">
  <!-- Fallback: Outer decorative ring - maroon -->
  <circle cx="80" cy="82" r="77" fill="#6B1219" stroke="#c9982b" stroke-width="3.5"/>
  <circle cx="80" cy="82" r="71" fill="none" stroke="#c9982b" stroke-width="1.2"/>
  <circle cx="80" cy="82" r="68" fill="none" stroke="#c9982b" stroke-width="0.5" stroke-dasharray="3,2"/>

  <!-- ── BODY ── -->
  <ellipse cx="80" cy="96" rx="13" ry="20" fill="#c9982b"/>
  <ellipse cx="80" cy="96" rx="9" ry="15" fill="#b8831a" opacity="0.35"/>

  <!-- ── LEFT WING (upper + lower layers) ── -->
  <path d="M68,86 C52,72 30,66 12,70 C8,74 10,82 20,80 C36,77 54,80 68,90 Z" fill="#c9982b"/>
  <path d="M68,93 C50,84 30,83 14,90 C11,95 14,102 24,100 C40,96 56,93 68,100 Z" fill="#c9982b" opacity="0.88"/>
  <!-- Wing-tip primary feathers left -->
  <path d="M12,70 L5,64 M10,76 L3,72 M10,82 L3,80 M11,88 L4,88 M13,93 L6,95"
        stroke="#c9982b" stroke-width="3" stroke-linecap="round" fill="none"/>
  <!-- Secondary feather lines left -->
  <path d="M20,80 L18,74 M28,78 L26,72 M36,76 L35,70 M44,75 L43,69"
        stroke="#b8831a" stroke-width="1.5" stroke-linecap="round" opacity="0.7" fill="none"/>

  <!-- ── RIGHT WING ── -->
  <path d="M92,86 C108,72 130,66 148,70 C152,74 150,82 140,80 C124,77 106,80 92,90 Z" fill="#c9982b"/>
  <path d="M92,93 C110,84 130,83 146,90 C149,95 146,102 136,100 C120,96 104,93 92,100 Z" fill="#c9982b" opacity="0.88"/>
  <path d="M148,70 L155,64 M150,76 L157,72 M150,82 L157,80 M149,88 L156,88 M147,93 L154,95"
        stroke="#c9982b" stroke-width="3" stroke-linecap="round" fill="none"/>
  <path d="M140,80 L142,74 M132,78 L134,72 M124,76 L125,70 M116,75 L117,69"
        stroke="#b8831a" stroke-width="1.5" stroke-linecap="round" opacity="0.7" fill="none"/>

  <!-- ── LEFT NECK ── -->
  <path d="M72,78 C64,62 52,46 46,30" stroke="#c9982b" stroke-width="11" fill="none" stroke-linecap="round"/>
  <path d="M72,78 C64,62 52,46 46,30" stroke="#b8831a" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.35"/>

  <!-- ── LEFT HEAD ── -->
  <ellipse cx="44" cy="25" rx="14" ry="11" fill="#c9982b" transform="rotate(-28,44,25)"/>
  <ellipse cx="44" cy="25" rx="10" ry="7" fill="#b8831a" transform="rotate(-28,44,25)" opacity="0.35"/>
  <!-- Left crown feathers -->
  <path d="M38,15 C36,7 35,2 37,0 C38,4 40,9 41,15" fill="#c9982b"/>
  <path d="M43,13 C42,5 42,0 44,0 C45,4 45,9 45,14" fill="#c9982b"/>
  <path d="M48,14 C48,6 49,1 51,0 C51,4 50,9 50,15" fill="#c9982b"/>
  <path d="M53,16 C54,8 55,3 57,2 C56,6 55,11 54,17" fill="#c9982b"/>
  <circle cx="37" cy="0" r="2.2" fill="#c9982b"/>
  <circle cx="44" cy="0" r="2.2" fill="#c9982b"/>
  <circle cx="51" cy="0" r="2.2" fill="#c9982b"/>
  <circle cx="57" cy="2" r="2.2" fill="#c9982b"/>
  <!-- Left upper beak -->
  <path d="M32,19 L18,12 L31,23 Z" fill="#c9982b"/>
  <!-- Left lower beak -->
  <path d="M32,26 L18,30 L31,26 Z" fill="#b8831a"/>
  <!-- Left eye -->
  <circle cx="41" cy="22" r="4" fill="#200800"/>
  <circle cx="41" cy="22" r="2.2" fill="#c9982b"/>
  <circle cx="40" cy="21" r="1" fill="#200800"/>
  <!-- Left wattle -->
  <path d="M32,26 C30,31 30,35 32,37" stroke="#c9982b" stroke-width="2" fill="none"/>

  <!-- ── RIGHT NECK ── -->
  <path d="M88,78 C96,62 108,46 114,30" stroke="#c9982b" stroke-width="11" fill="none" stroke-linecap="round"/>
  <path d="M88,78 C96,62 108,46 114,30" stroke="#b8831a" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.35"/>

  <!-- ── RIGHT HEAD ── -->
  <ellipse cx="116" cy="25" rx="14" ry="11" fill="#c9982b" transform="rotate(28,116,25)"/>
  <ellipse cx="116" cy="25" rx="10" ry="7" fill="#b8831a" transform="rotate(28,116,25)" opacity="0.35"/>
  <!-- Right crown feathers -->
  <path d="M122,15 C124,7 125,2 123,0 C122,4 120,9 119,15" fill="#c9982b"/>
  <path d="M117,13 C118,5 118,0 116,0 C115,4 115,9 115,14" fill="#c9982b"/>
  <path d="M112,14 C112,6 111,1 109,0 C109,4 110,9 110,15" fill="#c9982b"/>
  <path d="M107,16 C106,8 105,3 103,2 C104,6 105,11 106,17" fill="#c9982b"/>
  <circle cx="123" cy="0" r="2.2" fill="#c9982b"/>
  <circle cx="116" cy="0" r="2.2" fill="#c9982b"/>
  <circle cx="109" cy="0" r="2.2" fill="#c9982b"/>
  <circle cx="103" cy="2" r="2.2" fill="#c9982b"/>
  <!-- Right upper beak -->
  <path d="M128,19 L142,12 L129,23 Z" fill="#c9982b"/>
  <!-- Right lower beak -->
  <path d="M128,26 L142,30 L129,26 Z" fill="#b8831a"/>
  <!-- Right eye -->
  <circle cx="119" cy="22" r="4" fill="#200800"/>
  <circle cx="119" cy="22" r="2.2" fill="#c9982b"/>
  <circle cx="120" cy="21" r="1" fill="#200800"/>
  <!-- Right wattle -->
  <path d="M128,26 C130,31 130,35 128,37" stroke="#c9982b" stroke-width="2" fill="none"/>

  <!-- ── CHEST SHIELD ── -->
  <polygon points="80,80 70,94 80,101 90,94" fill="#6B1219" stroke="#c9982b" stroke-width="1.8"/>
  <polygon points="80,83 73,94 80,99 87,94" fill="none" stroke="#c9982b" stroke-width="0.8"/>
  <circle cx="80" cy="91" r="3.5" fill="#c9982b"/>

  <!-- ── TAIL FEATHERS ── -->
  <path d="M72,116 C68,126 64,132 60,138 L64,132 L68,140 L72,132 L76,142 L80,132 L84,142 L88,132 L92,140 L96,132 L100,138 C96,132 92,126 88,116 Z" fill="#c9982b"/>
  <line x1="80" y1="116" x2="80" y2="142" stroke="#6B1219" stroke-width="1"/>
  <path d="M66,124 L64,133 M72,120 L70,131 M78,118 L78,130 M86,120 L88,131 M94,124 L96,133"
        stroke="#b8831a" stroke-width="0.8" opacity="0.6" fill="none"/>

  <!-- ── LEGS AND TALONS ── -->
  <path d="M74,114 C69,120 64,124 60,129" stroke="#c9982b" stroke-width="4.5" fill="none" stroke-linecap="round"/>
  <path d="M60,129 L53,133 M60,129 L55,136 M60,129 L60,137 M60,129 L65,136"
        stroke="#c9982b" stroke-width="2.8" stroke-linecap="round" fill="none"/>
  <path d="M86,114 C91,120 96,124 100,129" stroke="#c9982b" stroke-width="4.5" fill="none" stroke-linecap="round"/>
  <path d="M100,129 L107,133 M100,129 L105,136 M100,129 L100,137 M100,129 L95,136"
        stroke="#c9982b" stroke-width="2.8" stroke-linecap="round" fill="none"/>

  <!-- ── BOTTOM BANNER ── -->
  <path d="M14,152 Q14,147 80,147 Q146,147 146,152 L146,163 Q146,168 80,168 Q14,168 14,163 Z" fill="#c9982b"/>
  <path d="M18,154 Q18,150 80,150 Q142,150 142,154 L142,161 Q142,165 80,165 Q18,165 18,161 Z"
        fill="none" stroke="#6B1219" stroke-width="0.8"/>
  <text x="80" y="162" font-family="Georgia,serif" font-size="9.5" fill="#6B1219"
        text-anchor="middle" font-weight="bold" letter-spacing="1">GOVT. OF KARNATAKA</text>
</svg>"""

		# ── Service categories rows (from web form: All Categories as per GST filings) ─
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
				<td style="padding:5px 8px;border:1px solid #d4b483;text-align:center;">{idx}</td>
				<td style="padding:5px 8px;border:1px solid #d4b483;">{category_name}</td>
				<td style="padding:5px 8px;border:1px solid #d4b483;color:#27ae60;font-weight:600;">Active</td>
			</tr>"""

		if not services_rows:
			services_rows = '<tr><td colspan="3" style="padding:8px;text-align:center;color:#888;font-style:italic;border:1px solid #d4b483;">No service categories registered</td></tr>'

		html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: "Times New Roman", Times, serif; background: #fff; color: #1a1a1a; font-size: 12px; }}
  .page {{ width: 210mm; min-height: 297mm; padding: 10mm 12mm; position: relative; }}
  .outer-border {{ border: 4px double #6B1219; padding: 8px; position: relative; min-height: 277mm; }}
  .inner-border {{ border: 1.5px solid #c9982b; padding: 12px 16px; position: relative; overflow: hidden; min-height: 269mm; }}
  .watermark {{
    position: absolute; top: 45%; left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 72px; color: rgba(107,18,25,0.06); font-weight: bold;
    white-space: nowrap; z-index: 0; letter-spacing: 4px;
  }}
  .section-head {{
    font-size: 11px; font-weight: bold; color: #fff; background: #6B1219;
    padding: 5px 10px; text-transform: uppercase; letter-spacing: 0.8px; margin: 10px 0 0;
  }}
  .details-table {{ width: 100%; border-collapse: collapse; }}
  .details-table td {{ padding: 6px 8px; border: 1px solid #d4b483; font-size: 11px; vertical-align: top; }}
  .details-table tr:nth-child(even) td {{ background: #fdf8ec; }}
  .lbl {{ font-weight: bold; color: #5a3a00; background: #fef9ee; width: 22%; }}
  .val {{ color: #1a1a1a; width: 28%; }}
  .reg-id {{ font-size: 13px; font-weight: bold; color: #6B1219; font-family: monospace; }}
  .svc-table {{ width: 100%; border-collapse: collapse; font-size: 11px; }}
  .svc-table th {{ background: #6B1219; color: #fff; padding: 6px 10px; text-align: left; border: 1px solid #6B1219; }}
  .declaration {{ background: #fff8f0; border-left: 4px solid #6B1219; padding: 8px 12px; font-size: 10.5px; color: #444; line-height: 1.6; margin-top: 10px; }}
  .footer {{ text-align: center; font-size: 9px; color: #777; border-top: 1px solid #d4b483; padding-top: 6px; margin-top: 10px; }}
</style>
</head>
<body>
<div class="page">
<div class="outer-border">
<div class="inner-border">
  <div class="watermark">KARNATAKA GOVT</div>

  <!-- ── Government Header ── -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2.5px solid #6B1219;padding-bottom:10px;margin-bottom:10px;">
    <tr>
      <td width="100" valign="middle" align="center">
        {logo_html}
      </td>
      <td valign="middle" align="center" style="padding:0 10px;">
        <div style="font-size:19px;font-weight:bold;color:#6B1219;letter-spacing:1px;">ಕರ್ನಾಟಕ ಸರ್ಕಾರ</div>
        <div style="font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:1.5px;margin-top:3px;color:#1a1a1a;">Government of Karnataka</div>
        <div style="font-size:11.5px;font-weight:bold;color:#6B1219;margin-top:4px;">Karnataka Platform Based Gig Workers</div>
        <div style="font-size:11.5px;font-weight:bold;color:#6B1219;">Social Security and Welfare Board</div>
        <div style="font-size:9.5px;color:#666;margin-top:3px;">Vikasa Soudha, Bengaluru &ndash; 560 001, Karnataka, India</div>
      </td>
      <td width="80" valign="middle" align="center">
        <div style="border:2px solid #2c5f2e;border-radius:5px;padding:6px 7px;font-size:8px;color:#2c5f2e;font-weight:bold;line-height:1.8;background:#f0fff0;width:72px;text-align:center;">
          &#10003;<br>VERIFIED<br>DOCUMENT
        </div>
      </td>
    </tr>
  </table>

  <!-- ── e-Stamp ── -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #2c5f2e;background:#f0fff0;padding:6px 12px;margin-bottom:10px;">
    <tr>
      <td valign="middle">
        <div style="color:#2c5f2e;font-weight:bold;font-size:10px;text-transform:uppercase;letter-spacing:.5px;">e-Stamp Reference</div>
        <div style="font-family:monospace;font-size:12px;font-weight:bold;letter-spacing:1.5px;color:#1a1a1a;">{estamp_ref}</div>
      </td>
      <td valign="middle" align="right">
        <div style="color:#2c5f2e;font-weight:bold;font-size:10px;text-transform:uppercase;">Date of Issue</div>
        <div style="color:#444;font-size:10.5px;font-weight:600;">{issue_date} &nbsp;at&nbsp; {issue_time} IST</div>
        <div style="color:#666;font-size:9.5px;">State: Karnataka &nbsp;|&nbsp; Category: Aggregator Registration</div>
      </td>
    </tr>
  </table>

  <!-- ── Certificate Title ── -->
  <div style="text-align:center;margin:8px 0 10px;padding:6px 0;border-top:1px solid #d4b483;border-bottom:1px solid #d4b483;">
    <div style="font-size:16px;text-transform:uppercase;letter-spacing:3px;color:#6B1219;font-weight:bold;">Certificate of Registration</div>
    <div style="font-size:10px;color:#555;margin-top:4px;font-style:italic;">
      Issued under the Karnataka Platform Based Gig Workers Social Security and Welfare Act
    </div>
  </div>

  <!-- ── Section 1: Registration Details (matches web form fields) ── -->
  <div class="section-head">&#9632;&nbsp; Aggregator Registration Details</div>
  <table class="details-table">
    <tr>
      <td class="lbl">Registration ID</td>
      <td class="val"><span class="reg-id">{self.name}</span></td>
      <td class="lbl">Registration Status</td>
      <td class="val"><b style="color:{status_color};">{self.status or "Submitted"}</b></td>
    </tr>
    <tr>
      <td class="lbl">Registered Name</td>
      <td class="val">{self.aggregator_name or "-"}</td>
      <td class="lbl">Registration Date</td>
      <td class="val">{issue_date}</td>
    </tr>
    <tr>
      <td class="lbl">Email</td>
      <td class="val">{self.email or "-"}</td>
      <td class="lbl">Mobile</td>
      <td class="val">{self.mobile or "-"}</td>
    </tr>
    <tr>
      <td class="lbl">Name of Authorised Person</td>
      <td class="val">{self.name1 or "-"}</td>
      <td class="lbl">Designation</td>
      <td class="val">{self.desigination or "-"}</td>
    </tr>
    <tr>
      <td class="lbl">PAN Number</td>
      <td class="val">{self.pan_number or "-"}</td>
      <td class="lbl">GSTIN</td>
      <td class="val">{self.gstin or "-"}</td>
    </tr>
    <tr>
      <td class="lbl">Company Type</td>
      <td class="val">{self.company_type or "-"}</td>
      <td class="lbl">Company ID / {self.company_type or "CIN"}</td>
      <td class="val">{self.company_id or self.cin_number or "-"}</td>
    </tr>
    <tr>
      <td class="lbl" style="vertical-align:top;">Registered Address</td>
      <td colspan="3" class="val">{self.registered_address or "-"}</td>
    </tr>
  </table>

  <!-- ── Section 2: All Categories of Business / Service as per GST Filings ── -->
  <div class="section-head">&#9632;&nbsp; All Categories of Business / Service as per GST Filings</div>
  <table class="svc-table">
    <thead>
      <tr>
        <th style="width:8%;text-align:center;">#</th>
        <th style="width:74%;">Service / Business Category</th>
        <th style="width:18%;text-align:center;">Status</th>
      </tr>
    </thead>
    <tbody>{services_rows}</tbody>
  </table>

  <!-- ── Declaration ── -->
  <div class="declaration">
    This is to certify that <b>{self.aggregator_name}</b> (Registration ID:&nbsp;<b>{self.name}</b>) has been duly
    registered as an Aggregator under the <i>Karnataka Platform Based Gig Workers Social Security and Welfare Act</i>.
    This certificate is system-generated and digitally authenticated by the Karnataka Gig Workers Welfare Board.
    Any tampering with this document is a punishable offence under applicable law.
    This certificate remains valid subject to continued compliance with the Act and Board regulations.
  </div>

  <!-- ── Signatures ── -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
    <tr>
      <td width="50%" align="center" style="font-size:10.5px;">
        <div style="border-top:1.5px solid #555;width:160px;margin:38px auto 5px;"></div>
        <div style="font-weight:bold;">Authorised Signatory</div>
        <div style="color:#555;margin-top:2px;">{self.name1 or "Authorised Person"}</div>
        <div style="color:#888;font-size:9.5px;">{self.aggregator_name or ""}</div>
      </td>
      <td width="50%" align="center" style="font-size:10.5px;">
        <div style="border-top:1.5px solid #555;width:160px;margin:38px auto 5px;"></div>
        <div style="font-weight:bold;">Registering Authority</div>
        <div style="color:#555;margin-top:2px;">Karnataka Gig Workers Welfare Board</div>
        <div style="color:#888;font-size:9.5px;">Vikasa Soudha, Bengaluru &ndash; 560 001</div>
      </td>
    </tr>
  </table>

  <!-- ── Footer ── -->
  <div class="footer">
    e-Stamp Ref: {estamp_ref} &nbsp;|&nbsp; Generated: {issue_date} {issue_time} IST &nbsp;|&nbsp;
    Karnataka Gig Workers Welfare Board, Vikasa Soudha, Bengaluru &ndash; 560 001
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
