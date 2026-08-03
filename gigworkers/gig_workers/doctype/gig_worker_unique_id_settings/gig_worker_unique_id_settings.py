# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

ID_PROOF_PLACEHOLDERS = {
	"PAN": "ABCDE1234F",
	"Driving Licence": "KA0120230012345",
}

AADHAR_SAMPLE_DIGITS = "123456789012"


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
			return self.get_aadhar_placeholder()
		return ID_PROOF_PLACEHOLDERS.get(proof_type, "")

	def get_aadhar_placeholder(self):
		return AADHAR_SAMPLE_DIGITS[-4:]
