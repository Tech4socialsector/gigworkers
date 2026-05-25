# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

# ============================================================
#  gigworkers — Gig Worker Controller
# ============================================================

import re
import hashlib
from datetime import datetime

import frappe
from frappe.model.document import Document
from frappe.utils import now, now_datetime, get_datetime, add_to_date
from frappe.utils.password import update_password


class GigWorker(Document):

	# --------------------------------------------------------
	#  gigworkers validation — field format checks
	# --------------------------------------------------------

	def validate(self):
		self.validate_email_format()
		self.validate_phone_format()
		self.validate_aadhaar_format()
		self.validate_pan_format()
		self.validate_dob()
		self.validate_eshram_id()

	def validate_email_format(self):
		if self.email:
			email_pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
			if not re.match(email_pattern, self.email.strip()):
				frappe.throw(
					f"❌ <b>Email</b> '{self.email}' is not a valid email address.<br>"
					"Please enter a valid email (e.g. worker@example.com).",
					title="Invalid Email",
				)

			# Check uniqueness across Gig Worker records
			existing_worker = frappe.db.get_value(
				"Gig Worker", {"email": self.email, "name": ("!=", self.name)}, "name"
			)
			if existing_worker:
				frappe.throw(
					f"❌ <b>Email</b> '{self.email}' is already registered with another Gig Worker.",
					title="Duplicate Email",
				)

			# Check uniqueness across Aggregator records
			existing_aggregator = frappe.db.get_value(
				"Aggregator", {"email": self.email}, "name"
			)
			if existing_aggregator:
				frappe.throw(
					f"❌ <b>Email</b> '{self.email}' is already registered as an Aggregator.",
					title="Duplicate Email",
				)

	def validate_phone_format(self):
		if self.phone:
			phone_clean = self.phone.strip()
			if not re.fullmatch(r"[6-9]\d{9}", phone_clean):
				frappe.throw(
					f"❌ <b>Phone</b> '{self.phone}' is not a valid phone number.<br>"
					"Please enter a 10-digit Indian mobile number starting with 6, 7, 8, or 9.",
					title="Invalid Phone Number",
				)

	def validate_aadhaar_format(self):
		if self.aadhaar_number:
			aadhaar_clean = self.aadhaar_number.replace(" ", "")
			if not re.fullmatch(r"[0-9]{12}", aadhaar_clean):
				frappe.throw(
					f"❌ <b>Aadhaar Number</b> '{self.aadhaar_number}' is not valid.<br>"
					"Please enter a valid 12-digit Aadhaar number.",
					title="Invalid Aadhaar Number",
				)

	def validate_pan_format(self):
		if self.pan_number:
			self.pan_number = self.pan_number.upper()
			if not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", self.pan_number):
				frappe.throw(
					f"❌ <b>PAN Number</b> '{self.pan_number}' is not valid.<br>"
					"Please enter a valid PAN (e.g., ABCDE1234F).",
					title="Invalid PAN Number",
				)

	def validate_dob(self):
		if self.dob:
			from frappe.utils import getdate, date_diff, today, now, get_datetime, add_to_date, now_datetime
			dob_date = getdate(self.dob)
			today_date = getdate(today())
			if dob_date > today_date:
				frappe.throw("❌ <b>Date of Birth</b> cannot be a future date.", title="Invalid Date of Birth")
			age_days = date_diff(today_date, dob_date)
			if age_days < 18 * 365:
				frappe.throw("❌ Gig Worker must be at least 18 years old.", title="Age Requirement Not Met")

	def validate_eshram_id(self):
		if self.eshram_id:
			self.eshram_id = self.eshram_id.upper()
			if not re.fullmatch(r"UW-[0-9]{12}", self.eshram_id):
				frappe.throw(
					f"❌ <b>eShram ID</b> '{self.eshram_id}' is not valid.<br>"
					"Please enter a valid eShram ID (e.g., UW-123456789012).",
					title="Invalid eShram ID",
				)
			existing = frappe.db.get_value(
				"Gig Worker", {"eshram_id": self.eshram_id, "name": ("!=", self.name)}, "name"
			)
			if existing:
				frappe.throw(
					f"❌ <b>eShram ID</b> '{self.eshram_id}' is already registered with another Gig Worker.",
					title="Duplicate eShram ID",
				)

	# --------------------------------------------------------
	#  gigworkers lifecycle — before insert: set aggregator
	# --------------------------------------------------------

	def before_insert(self):
		if not self.created_by_aggregator:
			aggregator = frappe.db.get_value(
				"Aggregator", {"email": frappe.session.user}, "name"
			)
			if aggregator:
				self.created_by_aggregator = aggregator

	# --------------------------------------------------------
	#  gigworkers lifecycle — after insert
	# --------------------------------------------------------

	def after_insert(self):
		# Records inserted via bulk import have already been written directly to the DB;
		# this hook runs only for single-document saves, so no guard needed here.
		# However, if explicitly flagged (e.g. from a script), skip heavy operations.
		if getattr(self.flags, "from_import", False):
			return

		from gigworkers.gig_workers.doctype.worker_mapping_log.worker_mapping_log import create_mapping_log

		if self.created_by_aggregator:
			# Aggregator-initiated registration: activate immediately
			frappe.db.set_value("Gig Worker", self.name, "status", "Active")
			self.status = "Active"
			self.create_user_with_role()
			create_mapping_log(
				gig_worker=self.name,
				event_type="Worker Registered",
				aggregator=self.created_by_aggregator,
				worker_status="Active",
				reference_doctype="Gig Worker",
				reference_name=self.name,
				remarks=f"Registered by aggregator {self.created_by_aggregator}",
			)
		else:
			# Self-registration: activate immediately
			frappe.db.set_value("Gig Worker", self.name, "status", "Active")
			self.status = "Active"
			self.create_user_with_role()

			agg = getattr(self, "preferred_aggregator", None) or None
			svc = getattr(self, "preferred_service", None) or None

			# If worker chose an aggregator, link them so the aggregator can see this worker
			if agg:
				frappe.db.set_value("Gig Worker", self.name, "created_by_aggregator", agg)

			create_mapping_log(
				gig_worker=self.name,
				event_type="Worker Registered",
				aggregator=agg,
				service=svc,
				worker_status="Active",
				reference_doctype="Gig Worker",
				reference_name=self.name,
				remarks="Self-registered" + (f" under {agg}" if agg else ""),
			)

			# If both aggregator and service are selected, create an onboarding mapping
			if agg and svc:
				try:
					frappe.get_doc({
						"doctype": "Worker Service Mapping",
						"gig_worker": self.name,
						"aggregator": agg,
						"service": svc,
						"status": "Onboarded",
						"start_date": frappe.utils.today(),
					}).insert(ignore_permissions=True)
					frappe.db.commit()
					create_mapping_log(
						gig_worker=self.name,
						event_type="Onboarded",
						aggregator=agg,
						service=svc,
						worker_status="Active",
						reference_doctype="Gig Worker",
						reference_name=self.name,
						remarks=f"Auto-onboarded to {agg} for service {svc} on self-registration",
					)
				except Exception:
					frappe.log_error(frappe.get_traceback(), "GigWorker: failed to auto-create Worker Service Mapping")

	# --------------------------------------------------------
	#  gigworkers — create Frappe User with Gig Worker role and send email
	# --------------------------------------------------------

	def _generate_registration_certificate_pdf(self):
		"""Generate a Karnataka Government-styled Gig Worker registration certificate PDF."""
		from frappe.utils.pdf import get_pdf

		issue_date = datetime.now().strftime("%d-%m-%Y")
		issue_time = datetime.now().strftime("%H:%M:%S")
		estamp_ref = "KA-GWB-" + hashlib.sha256(self.name.encode()).hexdigest()[:10].upper()

		masked_aadhaar = ("*" * 8 + str(self.aadhaar_number)[-4:]) if self.aadhaar_number else "-"

		aggregator_name = "-"
		if self.created_by_aggregator:
			aggregator_name = (
				frappe.db.get_value("Aggregator", self.created_by_aggregator, "aggregator_name")
				or self.created_by_aggregator
			)

		html = f"""
		<!DOCTYPE html>
		<html>
		<head>
		<meta charset="UTF-8">
		<style>
			* {{ box-sizing: border-box; margin: 0; padding: 0; }}
			body {{ font-family: "Times New Roman", Times, serif; background: #fff; color: #1a1a1a; font-size: 13px; }}
			.page {{ width: 210mm; min-height: 297mm; padding: 12mm 14mm; position: relative; }}

			.outer-border {{ border: 4px double #8B0000; padding: 10px; position: relative; min-height: 273mm; }}
			.inner-border {{ border: 1.5px solid #c0a020; padding: 14px 18px; min-height: 265mm; position: relative; }}

			.watermark {{
				position: fixed; top: 50%; left: 50%;
				transform: translate(-50%, -50%) rotate(-35deg);
				font-size: 80px; color: rgba(200,200,200,0.18);
				font-weight: bold; white-space: nowrap; pointer-events: none; z-index: 0; letter-spacing: 4px;
			}}

			.gov-header {{ text-align: center; border-bottom: 2px solid #8B0000; padding-bottom: 10px; margin-bottom: 10px; }}
			.kannada {{ font-size: 20px; font-weight: bold; color: #8B0000; letter-spacing: 1px; }}
			.eng-title {{ font-size: 16px; font-weight: bold; color: #1a1a1a; text-transform: uppercase; letter-spacing: 1px; margin-top: 3px; }}
			.dept {{ font-size: 12px; color: #333; margin-top: 3px; }}
			.board {{ font-size: 13px; font-weight: bold; color: #8B0000; margin-top: 4px; }}
			.emblem-row {{ display: flex; align-items: center; justify-content: space-between; }}
			.emblem {{ width: 70px; height: 70px; border: 2px solid #8B0000; border-radius: 50%;
			           display: flex; align-items: center; justify-content: center;
			           font-size: 9px; text-align: center; color: #8B0000; font-weight: bold; padding: 6px; }}

			.cert-title {{ text-align: center; margin: 14px 0 10px; }}
			.cert-title h2 {{ font-size: 17px; text-transform: uppercase; letter-spacing: 2px;
			                  color: #8B0000; text-decoration: underline; font-weight: bold; }}
			.cert-subtitle {{ font-size: 12px; margin-top: 4px; color: #444; }}

			.estamp-box {{
				border: 2px solid #2c5f2e; background: #f0fff0;
				padding: 8px 14px; margin-bottom: 14px;
				display: flex; justify-content: space-between; align-items: center; font-size: 11px;
			}}
			.estamp-label {{ color: #2c5f2e; font-weight: bold; font-size: 12px; }}
			.estamp-ref {{ font-family: monospace; font-size: 13px; font-weight: bold; color: #1a1a1a; letter-spacing: 1px; }}
			.estamp-date {{ color: #555; font-size: 11px; }}

			.section-head {{ font-size: 13px; font-weight: bold; color: #8B0000;
			                 border-bottom: 1px solid #8B0000; padding-bottom: 4px;
			                 margin: 14px 0 8px; text-transform: uppercase; letter-spacing: 1px; }}
			.details-table {{ width: 100%; border-collapse: collapse; margin-bottom: 14px; }}
			.details-table td {{ padding: 6px 10px; border-bottom: 1px solid #e0c080; font-size: 12px; }}
			.details-table tr:nth-child(even) td {{ background: #fdf8ec; }}
			.field-label {{ font-weight: bold; color: #555; width: 38%; }}
			.field-value {{ color: #1a1a1a; }}
			.reg-id {{ font-size: 15px; font-weight: bold; color: #8B0000; font-family: monospace; }}

			.declaration {{
				background: #fff8f0; border-left: 4px solid #8B0000;
				padding: 8px 12px; font-size: 11px; color: #444;
				margin-bottom: 14px; line-height: 1.6;
			}}
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
		        <div class="estamp-date" style="margin-top:3px;">State: Karnataka &nbsp;|&nbsp; Category: Gig Worker Registration</div>
		      </div>
		    </div>

		    <!-- Certificate Title -->
		    <div class="cert-title">
		      <h2>Certificate of Registration</h2>
		      <div class="cert-subtitle">Issued under the Karnataka Platform Based Gig Workers Social Security and Welfare Act</div>
		    </div>

		    <!-- Worker Details -->
		    <div class="section-head">Gig Worker Registration Details</div>
		    <table class="details-table">
		      <tr><td class="field-label">Worker ID</td>
		          <td class="field-value"><span class="reg-id">{self.name}</span></td></tr>
		      <tr><td class="field-label">Full Name</td>
		          <td class="field-value">{self.worker_name or "-"}</td></tr>
		      <tr><td class="field-label">Registered Email</td>
		          <td class="field-value">{self.email or "-"}</td></tr>
		      <tr><td class="field-label">Mobile Number</td>
		          <td class="field-value">{self.phone or "-"}</td></tr>
		      <tr><td class="field-label">Date of Birth</td>
		          <td class="field-value">{self.dob or "-"}</td></tr>
		      <tr><td class="field-label">Gender</td>
		          <td class="field-value">{self.gender or "-"}</td></tr>
		      <tr><td class="field-label">Aadhaar Number</td>
		          <td class="field-value">{masked_aadhaar}</td></tr>
		      <tr><td class="field-label">PAN Number</td>
		          <td class="field-value">{self.pan_number or "-"}</td></tr>
		      <tr><td class="field-label">eShram ID</td>
		          <td class="field-value">{self.eshram_id or "-"}</td></tr>
		      <tr><td class="field-label">Location of Work</td>
		          <td class="field-value">{self.location_of_work or "-"}</td></tr>
		      <tr><td class="field-label">Registered Under Aggregator</td>
		          <td class="field-value">{aggregator_name}</td></tr>
		      <tr><td class="field-label">Registration Status</td>
		          <td class="field-value"><b style="color:#27ae60;">{self.status or "Active"}</b></td></tr>
		      <tr><td class="field-label">Registration Date</td>
		          <td class="field-value">{issue_date}</td></tr>
		    </table>

		    <!-- Declaration -->
		    <div class="declaration">
		      This is to certify that <b>{self.worker_name}</b> (Worker ID: <b>{self.name}</b>) has been
		      registered as a Gig Worker under the <i>Karnataka Platform Based Gig Workers Social Security and Welfare Act</i>.
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
			frappe.log_error(f"PDF generation failed for {self.name}: {e}", "Gig Worker Certificate PDF Error")
			return None

	def create_user_with_role(self):
		if not self.email or not self.phone:
			return

		if not frappe.db.exists("User", self.email):
			user = frappe.get_doc({
				"doctype": "User",
				"email": self.email,
				"first_name": self.worker_name,
				"send_welcome_email": 0,
				"roles": [{"role": "Gig Worker"}],
			})
			user.flags.ignore_password_policy = True
			user.insert(ignore_permissions=True)
		else:
			user = frappe.get_doc("User", self.email)
			existing_roles = [r.role for r in user.roles]
			if "Gig Worker" not in existing_roles:
				user.append("roles", {"role": "Gig Worker"})
				user.save(ignore_permissions=True)

		# Link user back to this Gig Worker record
		self.db_set("user", self.email, update_modified=False)

		update_password(self.email, self.phone)

		login_url = frappe.utils.get_url("/login")

		attachments = []
		pdf = self._generate_registration_certificate_pdf()
		if pdf:
			attachments.append({
				"fname": f"Registration_Certificate_{self.name}.pdf",
				"fcontent": pdf,
			})

		try:
			frappe.sendmail(
				recipients=[self.email],
				subject=f"[{self.name}] Registration Successful – Karnataka Gig Workers Welfare Board",
				message=f"""
				<p>Dear <b>{self.worker_name}</b>,</p>
				<p>You have been successfully registered as a Gig Worker under the
				<b>Karnataka Platform Based Gig Workers Social Security and Welfare Board</b>.</p>
				<table style="border-collapse:collapse;margin:12px 0;font-size:13px;">
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Worker ID</b></td><td><b style="color:#8B0000;">{self.name}</b></td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Login URL</b></td><td><a href="{login_url}">{login_url}</a></td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Username</b></td><td>{self.email}</td></tr>
				  <tr><td style="padding:4px 16px 4px 0;color:#555;"><b>Password</b></td><td>Your registered mobile number</td></tr>
				</table>
				<p>Your official <b>Registration Certificate</b> is attached to this email. Please log in and change your password immediately.</p>
				<p>Thank you,<br><b>Karnataka Gig Workers Welfare Board</b></p>
				""",
				attachments=attachments,
			)
		except Exception as e:
			frappe.log_error(
				message=f"Registration email failed for {self.name}: {e}",
				title="Gig Worker Registration Email Error",
			)


