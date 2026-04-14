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

		# Validate each service row
		service_names = []
		for svc in (self.categories_of_business or []):
			svc_label = svc.service_name or f"Row {svc.idx}"

			if svc.service_name in service_names:
				frappe.throw(f"Duplicate service '{svc.service_name}' — each service name must be unique.")
			service_names.append(svc.service_name)

			if svc.pan:
				svc.pan = svc.pan.upper()
				if not re.match(r'^[A-Z]{5}[0-9]{4}[A-Z]{1}$', svc.pan):
					frappe.throw(f"[{svc_label}] Invalid PAN Format. Should be like ABCDE1234F.")

			if svc.gstin:
				svc.gstin = svc.gstin.upper()
				if not re.match(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$', svc.gstin):
					frappe.throw(f"[{svc_label}] Invalid GSTIN Format. Should be 15 characters like 22ABCDE1234F1Z5.")

			if svc.company_type and svc.company_id:
				if svc.company_type == 'CIN':
					if not re.match(r'^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[Pp][Ll][Cc][0-9]{6}$', svc.company_id):
						frappe.throw(f"[{svc_label}] Invalid CIN Format. Should be like L12345AB2020PLC123456.")
				elif svc.company_type == 'LLPIN':
					if not re.match(r'^[A-Z]{3}-[0-9]{4}$', svc.company_id.upper()):
						frappe.throw(f"[{svc_label}] Invalid LLPIN Format. Should be like AAA-1234.")

	def after_insert(self):
		frappe.db.set_value("Aggregator", self.name, "status", "Submitted")
		self.status = "Submitted"
		self.send_status_email("Submitted")
		self.notify_admins_for_approval()

	def on_update(self):
		previous_status = self.get_doc_before_save()
		if previous_status and previous_status.status != self.status and self.status in ("Under Process", "Approved", "Rejected"):
			if self.status == "Approved":
				self.create_user_with_role()
				self._generate_and_send_api_key()
			self.send_status_email(self.status)
			self.notify_admins_on_status_change(self.status)

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
					f"<p>Please review and update the status to <b>Approved</b> or <b>Rejected</b>.</p>"
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
		if status not in ("Under Process", "Approved", "Rejected"):
			return
		status_labels = {
			"Under Process": "is now Under Process",
			"Approved": "has been Approved",
			"Rejected": "has been Rejected",
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

		try:
			frappe.sendmail(
				recipients=[self.email],
				subject="Your API Credentials – Gig Workers Portal",
				message=f"""
				<p>Dear {self.aggregator_name},</p>
				<p>Your aggregator account is now <b>approved</b>. Use the credentials below for programmatic API access to the portal:</p>
				<table style="border-collapse:collapse;margin-top:12px;font-family:monospace;">
				  <tr><td style="padding:4px 16px 4px 0"><b>API Key</b></td><td>{api_key}</td></tr>
				  <tr><td style="padding:4px 16px 4px 0"><b>API Secret</b></td><td>{api_secret}</td></tr>
				</table>
				<p>Pass these as <code>Authorization: token api_key:api_secret</code> in your request headers.</p>
				<p><b>Keep these credentials secure and do not share them.</b></p>
				<p>Thank you,<br>Gig Workers Welfare Team</p>
				""",
			)
		except Exception as e:
			frappe.log_error(
				message=f"API key email failed for aggregator {self.name}: {e}",
				title="Aggregator API Key Email Error",
			)

	def _generate_registration_certificate_pdf(self):
		"""Generate a Karnataka Government-styled registration certificate PDF."""
		from frappe.utils.pdf import get_pdf

		base_url    = frappe.utils.get_url()
		login_url   = f"{base_url}/login"
		issue_date  = datetime.now().strftime("%d-%m-%Y")
		issue_time  = datetime.now().strftime("%H:%M:%S")
		estamp_ref  = "KA-GWB-" + hashlib.sha256(self.name.encode()).hexdigest()[:10].upper()

		services_rows = ""
		for svc in (self.categories_of_business or []):
			services_rows += f"""
			<tr>
				<td>{svc.service_name or "-"}</td>
				<td>{svc.brand_name or "-"}</td>
				<td>{svc.company_type or "-"}</td>
				<td>{svc.gstin or "-"}</td>
				<td style="color:#27ae60;font-weight:bold;">{svc.service_status or "Active"}</td>
			</tr>"""

		html = f"""
		<!DOCTYPE html>
		<html>
		<head>
		<meta charset="UTF-8">
		<style>
			@import url('https://fonts.googleapis.com/css2?family=Times+New+Roman&display=swap');
			* {{ box-sizing: border-box; margin: 0; padding: 0; }}
			body {{ font-family: "Times New Roman", Times, serif; background: #fff; color: #1a1a1a; font-size: 13px; }}
			.page {{ width: 210mm; min-height: 297mm; padding: 12mm 14mm; position: relative; }}

			/* Outer decorative border */
			.outer-border {{
				border: 4px double #8B0000;
				padding: 10px;
				position: relative;
				min-height: 273mm;
			}}
			.inner-border {{
				border: 1.5px solid #c0a020;
				padding: 14px 18px;
				min-height: 265mm;
				position: relative;
			}}

			/* Watermark */
			.watermark {{
				position: fixed;
				top: 50%;
				left: 50%;
				transform: translate(-50%, -50%) rotate(-35deg);
				font-size: 80px;
				color: rgba(200,200,200,0.18);
				font-weight: bold;
				white-space: nowrap;
				pointer-events: none;
				z-index: 0;
				letter-spacing: 4px;
			}}

			/* Header */
			.gov-header {{ text-align: center; border-bottom: 2px solid #8B0000; padding-bottom: 10px; margin-bottom: 10px; }}
			.kannada {{ font-size: 20px; font-weight: bold; color: #8B0000; letter-spacing: 1px; }}
			.eng-title {{ font-size: 16px; font-weight: bold; color: #1a1a1a; text-transform: uppercase; letter-spacing: 1px; margin-top: 3px; }}
			.dept {{ font-size: 12px; color: #333; margin-top: 3px; }}
			.board {{ font-size: 13px; font-weight: bold; color: #8B0000; margin-top: 4px; }}

			/* Emblem placeholder */
			.emblem-row {{ display: flex; align-items: center; justify-content: space-between; }}
			.emblem {{ width: 70px; height: 70px; border: 2px solid #8B0000; border-radius: 50%;
			           display: flex; align-items: center; justify-content: center;
			           font-size: 9px; text-align: center; color: #8B0000; font-weight: bold; padding: 6px; }}

			/* Certificate title */
			.cert-title {{ text-align: center; margin: 14px 0 10px; }}
			.cert-title h2 {{ font-size: 17px; text-transform: uppercase; letter-spacing: 2px;
			                  color: #8B0000; text-decoration: underline; font-weight: bold; }}
			.cert-subtitle {{ font-size: 12px; margin-top: 4px; color: #444; }}

			/* E-Stamp box */
			.estamp-box {{
				border: 2px solid #2c5f2e;
				background: #f0fff0;
				padding: 8px 14px;
				margin-bottom: 14px;
				display: flex;
				justify-content: space-between;
				align-items: center;
				font-size: 11px;
			}}
			.estamp-label {{ color: #2c5f2e; font-weight: bold; font-size: 12px; }}
			.estamp-ref {{ font-family: monospace; font-size: 13px; font-weight: bold; color: #1a1a1a; letter-spacing: 1px; }}
			.estamp-date {{ color: #555; font-size: 11px; }}

			/* Details table */
			.details-table {{ width: 100%; border-collapse: collapse; margin-bottom: 14px; }}
			.details-table th {{
				background: #8B0000; color: #fff; padding: 7px 10px;
				text-align: left; font-size: 12px; letter-spacing: 0.5px;
			}}
			.details-table td {{ padding: 6px 10px; border-bottom: 1px solid #e0c080; font-size: 12px; }}
			.details-table tr:nth-child(even) td {{ background: #fdf8ec; }}
			.field-label {{ font-weight: bold; color: #555; width: 38%; }}
			.field-value {{ color: #1a1a1a; }}
			.reg-id {{ font-size: 15px; font-weight: bold; color: #8B0000; font-family: monospace; }}

			/* Services table */
			.section-head {{ font-size: 13px; font-weight: bold; color: #8B0000; border-bottom: 1px solid #8B0000;
			                 padding-bottom: 4px; margin: 14px 0 8px; text-transform: uppercase; letter-spacing: 1px; }}
			.svc-table {{ width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px; }}
			.svc-table th {{ background: #4a4a4a; color: #fff; padding: 6px 8px; text-align: left; }}
			.svc-table td {{ padding: 5px 8px; border-bottom: 1px solid #ddd; }}
			.svc-table tr:nth-child(even) td {{ background: #f9f9f9; }}

			/* Login box */
			.login-box {{
				background: #f0f4ff;
				border: 1.5px solid #2c3e8c;
				padding: 10px 14px;
				margin-bottom: 14px;
				font-size: 12px;
			}}
			.login-box a {{ color: #2c3e8c; font-weight: bold; }}

			/* Declaration */
			.declaration {{
				background: #fff8f0;
				border-left: 4px solid #8B0000;
				padding: 8px 12px;
				font-size: 11px;
				color: #444;
				margin-bottom: 14px;
				line-height: 1.6;
			}}

			/* Signature row */
			.sig-row {{ display: flex; justify-content: space-between; margin-top: 20px; font-size: 11px; }}
			.sig-block {{ text-align: center; }}
			.sig-line {{ border-top: 1px solid #333; width: 160px; margin: 40px auto 4px; }}

			/* Footer */
			.footer {{ text-align: center; font-size: 10px; color: #888; border-top: 1px solid #ccc; padding-top: 8px; margin-top: 10px; }}
		</style>
		</head>
		<body>
		<div class="page">
		  <div class="watermark">GOVT OF KARNATAKA</div>
		  <div class="outer-border">
		  <div class="inner-border">

		    <!-- Government Header -->
		    <div class="gov-header">
		      <div class="emblem-row">
		        <div class="emblem">ಕರ್ನಾಟಕ<br>ರಾಜ್ಯ<br>ಲಾಂಛನ</div>
		        <div style="flex:1; padding: 0 16px;">
		          <div class="kannada">ಕರ್ನಾಟಕ ಸರ್ಕಾರ</div>
		          <div class="eng-title">Government of Karnataka</div>
		          <div class="dept">Department of Labour, Skill Development, Employment and Livelihood</div>
		          <div class="board">Karnataka Platform Based Gig Workers Social Security and Welfare Board</div>
		          <div class="dept" style="margin-top:2px;">Vikasa Soudha, Bengaluru – 560 001, Karnataka, India</div>
		        </div>
		        <div class="emblem">VERIFIED<br>DOCUMENT<br>✓</div>
		      </div>
		    </div>

		    <!-- E-Stamp -->
		    <div class="estamp-box">
		      <div>
		        <div class="estamp-label">🔖 e-Stamp Reference</div>
		        <div class="estamp-ref">{estamp_ref}</div>
		      </div>
		      <div style="text-align:right;">
		        <div class="estamp-label">Date of Issue</div>
		        <div class="estamp-date">{issue_date} at {issue_time} IST</div>
		        <div class="estamp-date" style="margin-top:3px;">State: Karnataka &nbsp;|&nbsp; Category: Aggregator Registration</div>
		      </div>
		    </div>

		    <!-- Certificate Title -->
		    <div class="cert-title">
		      <h2>Certificate of Registration</h2>
		      <div class="cert-subtitle">Issued under the Karnataka Platform Based Gig Workers Social Security and Welfare Act</div>
		    </div>

		    <!-- Registration Details -->
		    <div class="section-head">Aggregator Registration Details</div>
		    <table class="details-table">
		      <tr><td class="field-label">Registration ID</td>
		          <td class="field-value"><span class="reg-id">{self.name}</span></td></tr>
		      <tr><td class="field-label">Aggregator / Company Name</td>
		          <td class="field-value">{self.aggregator_name or "-"}</td></tr>
		      <tr><td class="field-label">Authorised Person</td>
		          <td class="field-value">{self.name1 or "-"}</td></tr>
		      <tr><td class="field-label">Designation</td>
		          <td class="field-value">{self.desigination or "-"}</td></tr>
		      <tr><td class="field-label">Registered Email</td>
		          <td class="field-value">{self.email or "-"}</td></tr>
		      <tr><td class="field-label">Mobile Number</td>
		          <td class="field-value">{self.mobile or "-"}</td></tr>
		      <tr><td class="field-label">Gender</td>
		          <td class="field-value">{self.gender or "-"}</td></tr>
		      <tr><td class="field-label">Date of Birth</td>
		          <td class="field-value">{self.date_of_birth or "-"}</td></tr>
		      <tr><td class="field-label">Aadhaar Number</td>
		          <td class="field-value">{("*" * 8 + str(self.aadhaar_number)[-4:]) if self.aadhaar_number else "-"}</td></tr>
		      <tr><td class="field-label">Registration Status</td>
		          <td class="field-value"><b style="color:#e67e22;">{self.status or "Submitted"}</b></td></tr>
		      <tr><td class="field-label">Registration Date</td>
		          <td class="field-value">{issue_date}</td></tr>
		    </table>

		    <!-- Services -->
		    <div class="section-head">Categories of Business / Aggregation Activities (as per GST Filings)</div>
		    <table class="svc-table">
		      <thead>
		        <tr>
		          <th>Service Name</th>
		          <th>Brand / App Name</th>
		          <th>Company Type</th>
		          <th>GSTIN</th>
		          <th>Status</th>
		        </tr>
		      </thead>
		      <tbody>
		        {services_rows if services_rows else '<tr><td colspan="5" style="text-align:center;color:#888;">No services registered yet</td></tr>'}
		      </tbody>
		    </table>

		    <!-- Declaration -->
		    <div class="declaration">
		      This is to certify that <b>{self.aggregator_name}</b> (Registration ID: <b>{self.name}</b>) has been
		      registered as an Aggregator under the <i>Karnataka Platform Based Gig Workers Social Security and Welfare Act</i>.
		      This certificate is system-generated and is digitally authenticated by the Karnataka Gig Workers Welfare Board.
		      Any tampering with this document is a punishable offence under applicable law.
		      This certificate is valid subject to continued compliance with the Act and Board regulations.
		    </div>

		    <!-- Footer -->
		    <div class="footer">
		      e-Stamp Ref: {estamp_ref} &nbsp;|&nbsp; Generated: {issue_date} {issue_time} IST &nbsp;|&nbsp;
		      Karnataka Gig Workers Welfare Board, Vikasa Soudha, Bengaluru – 560 001
		      <br>Helpline: 1800-XXX-XXXX &nbsp;|&nbsp; Email: support@kgwwb.karnataka.gov.in
		    </div>

		  </div>
		  </div>
		</div>
		</body>
		</html>
		"""

		try:
			return get_pdf(html, {
				"orientation": "Portrait",
				"margin-top": "0",
				"margin-bottom": "0",
				"margin-left": "0",
				"margin-right": "0"
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
			"Rejected": {
				"subject": f"[{self.name}] Application Rejected – Karnataka Gig Workers Welfare Board",
				"body": f"""
				<p>Dear <b>{self.aggregator_name}</b>,</p>
				<p>We regret to inform you that your aggregator application (ID: <b>{self.name}</b>) has been <b>rejected</b>.</p>
				<p>Please contact the admin for more information.</p>
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
			)
		except Exception as e:
			frappe.log_error(
				message=f"Status email failed for aggregator {self.name}: {e}",
				title="Aggregator Status Email Error",
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
			# User exists, ensure Aggregator role is assigned
			user = frappe.get_doc("User", self.email)
			existing_roles = [r.role for r in user.roles]
			if "Aggregator" not in existing_roles:
				user.append("roles", {"role": "Aggregator"})
				user.save(ignore_permissions=True)
			user = frappe.get_doc("User", self.email)

		update_password(self.email, self.mobile)
