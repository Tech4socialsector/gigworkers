# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

# ============================================================
#  gigworkers — Gig Worker Controller
# ============================================================

import re

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
		from gigworkers.gig_workers.doctype.worker_mapping_log.worker_mapping_log import create_mapping_log

		if self.created_by_aggregator:
			# Aggregator-initiated registration: hold activation pending worker's consent
			# (requirements §1.4.2 — send one-time verification link to the gig worker)
			self._send_verification_link()
			create_mapping_log(
				gig_worker=self.name,
				event_type="Worker Registered",
				aggregator=self.created_by_aggregator,
				worker_status="Pending Verification",
				reference_doctype="Gig Worker",
				reference_name=self.name,
				remarks=f"Registered by aggregator {self.created_by_aggregator}",
			)
		else:
			# Self-registration: activate immediately
			frappe.db.set_value("Gig Worker", self.name, "status", "Active")
			self.status = "Active"
			self.create_user_with_role()

			agg = self.preferred_aggregator or None
			svc = self.preferred_service or None

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

	def _send_verification_link(self):
		"""Set status to Pending Verification and email a one-time activation link."""
		import secrets
		token = secrets.token_urlsafe(32)

		frappe.db.set_value("Gig Worker", self.name, {
			"status": "Pending Verification",
			"verification_token": token,
			"token_created_at": now(),
		})

		if not self.email:
			return

		base_url = frappe.utils.get_url()
		verify_link = (
			f"{base_url}/api/method/gigworkers.gig_workers.doctype.gig_worker"
			f".gig_worker.verify_worker_registration?token={token}"
		)

		agg_name = frappe.db.get_value(
			"Aggregator", self.created_by_aggregator, "aggregator_name"
		) or self.created_by_aggregator

		try:
			frappe.sendmail(
				recipients=[self.email],
				subject="Action Required: Verify Your Registration – Gig Workers Portal",
				message=f"""
				<p>Dear {self.worker_name},</p>
				<p>You have been registered on the <b>Gig Workers Welfare Portal</b> by <b>{agg_name}</b>.</p>
				<p>Please click the button below to verify and activate your account:</p>
				<div style="margin:30px 0;">
					<a href="{verify_link}"
					   style="display:inline-block;background-color:#4CAF50;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;font-weight:bold;">
						Verify My Registration
					</a>
				</div>
				<p>If the button doesn't work, copy and paste this link into your browser:<br>
				<a href="{verify_link}">{verify_link}</a></p>
				<p>If you were not expecting this registration, please ignore this email.</p>
				<p>Thank you,<br>Gig Workers Welfare Team</p>
				""",
			)
		except Exception as e:
			frappe.log_error(
				message=f"Verification email failed for {self.name}: {e}",
				title="Gig Worker Verification Email Error",
			)

	# --------------------------------------------------------
	#  gigworkers — create Frappe User with Gig Worker role and send email
	# --------------------------------------------------------

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
		try:
			frappe.sendmail(
				recipients=[self.email],
				subject="Registration Successful - Gig Worker",
				message=f"""
				<p>Dear {self.worker_name},</p>
				<p>You have been successfully registered as a Gig Worker.</p>
				<p>Here are your login credentials:</p>
				<ul>
					<li><b>Login URL:</b> <a href="{login_url}">{login_url}</a></li>
					<li><b>Username/Email:</b> {self.email}</li>
					<li><b>Password:</b> {self.phone}</li>
				</ul>
				<p>Please log in and change your password as soon as possible.</p>
				<p>Thank you,<br>Gig Workers Team</p>
				""",
			)
		except Exception as e:
			frappe.log_error(
				message=f"Registration email failed for {self.name}: {e}",
				title="Gig Worker Registration Email Error",
			)


# ------------------------------------------------------------
# Public API: Verify gig worker registration (aggregator flow)
# ------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def verify_worker_registration(token):
	"""Called when a gig worker clicks the one-time verification link sent during
	aggregator-initiated registration (requirements §1.4.2).

	On success: activates the worker and creates their login account.
	"""
	row = frappe.db.get_value(
		"Gig Worker",
		{"verification_token": token, "status": "Pending Verification"},
		["name", "token_created_at"],
		as_dict=True,
	)

	if not row:
		frappe.respond_as_web_page(
			"Verification Failed",
			"This verification link is invalid or has already been used. "
			"Please contact your aggregator or the portal admin.",
			indicator_color="red",
			http_status_code=400,
		)
		return

	worker_name = row.name

	# Check 48-hour expiry
	TOKEN_EXPIRY_HOURS = 48
	if row.token_created_at:
		from frappe.utils import now_datetime, get_datetime
		created = get_datetime(row.token_created_at)
		if (now_datetime() - created).total_seconds() > TOKEN_EXPIRY_HOURS * 3600:
			frappe.db.set_value("Gig Worker", worker_name, {"verification_token": "", "token_created_at": None})
			frappe.respond_as_web_page(
				"Link Expired",
				f"This verification link has expired (valid for {TOKEN_EXPIRY_HOURS} hours). "
				"Please contact your aggregator to resend the verification email.",
				indicator_color="orange",
				http_status_code=400,
			)
			return

	# Activate the worker and clear the one-time token
	frappe.db.set_value("Gig Worker", worker_name, {
		"status": "Active",
		"verification_token": "",
		"token_created_at": None,
	})

	worker = frappe.get_doc("Gig Worker", worker_name)
	worker.create_user_with_role()

	from gigworkers.gig_workers.doctype.worker_mapping_log.worker_mapping_log import create_mapping_log
	create_mapping_log(
		gig_worker=worker_name,
		event_type="Worker Activated",
		aggregator=worker.created_by_aggregator or None,
		worker_status="Active",
		reference_doctype="Gig Worker",
		reference_name=worker_name,
		remarks="Worker verified email and activated account",
	)

	frappe.respond_as_web_page(
		"Registration Verified",
		f"Welcome, {worker.worker_name}! Your registration has been verified. "
		"You can now log in to the Gig Workers Welfare Portal.",
		indicator_color="green",
	)


# ------------------------------------------------------------
# Admin API: Resend verification email for a pending worker
# ------------------------------------------------------------

@frappe.whitelist()
def resend_verification_email(worker_name):
	"""Regenerate verification token and resend the email.
	Used when the original verification link failed (e.g. due to a migration issue).
	"""
	frappe.only_for(["System Manager", "Aggregator"])

	worker = frappe.get_doc("Gig Worker", worker_name)

	if worker.status == "Active":
		frappe.throw("This worker is already active.")

	if not worker.created_by_aggregator:
		frappe.throw("Resend is only applicable to aggregator-registered workers.")

	worker._send_verification_link()
	frappe.db.commit()

	return {"message": f"Verification email resent to {worker.email}"}
