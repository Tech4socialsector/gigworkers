# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

ID_PROOF_PLACEHOLDERS = {
	"PAN": "ABCDE1234F",
	"Driving Licence": "KA0120230012345",
}

# Fieldname on Gig Worker that holds the raw value for each ID proof type.
ID_PROOF_FIELDNAMES = {
	"PAN": "pan_number",
	"Driving Licence": "drivers_license_number",
	"Aadhar": "aadhaar_number",
}

AADHAR_SAMPLE_DIGITS = "123456789012"


class MissingIDProofValue(Exception):
	"""Raised when a Gig Worker is missing the value for an ID proof required by settings."""

	def __init__(self, proof_type):
		self.proof_type = proof_type
		super().__init__(f"{proof_type} is required to generate the Unique ID but is missing.")


class GigWorkerUniqueIDSettings(Document):
	def validate(self):
		self.validate_id_proof_selection()
		self.validate_suffix()
		self.validate_aadhar_display_format()
		self.preview_format = self.get_preview_format()

	def validate_id_proof_selection(self):
		if not self.get_selected_proof_types():
			frappe.throw("Please select at least one ID proof to base the Unique ID on.")

	def validate_suffix(self):
		if self.suffix and not self.suffix.isdigit():
			frappe.throw("Suffix (Starting Running Number) must contain digits only, e.g. 001.")

	def validate_aadhar_display_format(self):
		if "Aadhar" in self.get_selected_proof_types() and not self.aadhar_display_format:
			frappe.throw("Please select an Aadhar Number Display Format.")

	def get_selected_proof_types(self):
		if self.id_proof_mode == "Single ID Proof":
			return [self.id_proof_type] if self.id_proof_type else []

		proof_types = []
		if self.allow_pan:
			proof_types.append("PAN")
		if self.allow_driving_licence:
			proof_types.append("Driving Licence")
		if self.allow_aadhar:
			proof_types.append("Aadhar")
		return proof_types

	def mask_aadhar(self, aadhar_number):
		if not aadhar_number:
			return aadhar_number
		if self.aadhar_display_format == "Full":
			return aadhar_number
		if self.aadhar_display_format == "First 4 Digits":
			return aadhar_number[:4]
		# default: Last 4 Digits
		return aadhar_number[-4:]

	def get_preview_format(self):
		parts = []
		if self.need_prefix and self.prefix:
			parts.append(self.prefix)

		parts.extend(self.get_id_proof_placeholder(proof_type) for proof_type in self.get_selected_proof_types())

		if self.suffix:
			parts.append(self.suffix)

		preview = "-".join(parts)

		if self.suffix and self.suffix.isdigit():
			next_suffix = str(int(self.suffix) + 1).zfill(len(self.suffix))
			preview += f"  (next: ...-{next_suffix})"

		return preview

	def get_id_proof_placeholder(self, proof_type):
		if proof_type == "Aadhar":
			return self.mask_aadhar(AADHAR_SAMPLE_DIGITS)
		return ID_PROOF_PLACEHOLDERS.get(proof_type, "")


def mask_aadhar_for_display(aadhar_number, display_format=None):
	"""Mask a real Aadhar number for display (X-padded to preserve length), independent
	of the compact, unpadded masking used when building the Unique ID itself."""
	if not aadhar_number:
		return aadhar_number

	display_format = display_format or frappe.db.get_single_value(
		"Gig Worker Unique ID Settings", "aadhar_display_format"
	) or "Last 4 Digits"

	if display_format == "Full":
		return aadhar_number
	if display_format == "First 4 Digits":
		return aadhar_number[:4] + "X" * max(len(aadhar_number) - 4, 0)
	# default: Last 4 Digits
	return "X" * max(len(aadhar_number) - 4, 0) + aadhar_number[-4:]


def get_id_proof_value(values, proof_type):
	"""Read the raw ID proof value out of `values` (a Gig Worker Document or a plain dict)."""
	fieldname = ID_PROOF_FIELDNAMES.get(proof_type)
	if not fieldname:
		return None
	return values.get(fieldname)


def reserve_next_suffix():
	"""Atomically read-and-increment the running suffix on Gig Worker Unique ID Settings.

	Locks the settings row for the rest of the current transaction so two Gig
	Workers created at the same time can never reserve the same number.
	Returns the reserved value as a zero-padded string, or None if no suffix
	is configured.
	"""
	frappe.db.sql(
		"select `value` from `tabSingles` where doctype=%s and field='suffix' for update",
		"Gig Worker Unique ID Settings",
	)
	current = frappe.db.get_single_value("Gig Worker Unique ID Settings", "suffix")
	if not current:
		return None

	width = len(current)
	frappe.db.set_single_value(
		"Gig Worker Unique ID Settings", "suffix", str(int(current) + 1).zfill(width)
	)
	return current


def generate_unique_id(values, settings=None):
	"""Build a Gig Worker Unique ID from `values` (a Gig Worker Document, or a plain
	dict with pan_number / drivers_license_number / aadhaar_number keys), based on
	the active Gig Worker Unique ID Settings.

	Returns None if no ID proof is configured in settings (feature not enabled).
	Raises MissingIDProofValue if a configured ID proof's value is missing from `values`.
	"""
	settings = settings or frappe.get_single("Gig Worker Unique ID Settings")
	proof_types = settings.get_selected_proof_types()
	if not proof_types:
		return None

	parts = []
	if settings.need_prefix and settings.prefix:
		parts.append(settings.prefix)

	for proof_type in proof_types:
		value = get_id_proof_value(values, proof_type)
		if not value:
			raise MissingIDProofValue(proof_type)
		if proof_type == "Aadhar":
			value = mask_aadhar_for_display(value, settings.aadhar_display_format)
		parts.append(value)

	suffix = reserve_next_suffix()
	if suffix:
		parts.append(suffix)

	return "-".join(parts)
