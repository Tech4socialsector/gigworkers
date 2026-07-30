# Copyright (c) 2026, Jenifar and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

ID_PROOF_PLACEHOLDERS = {
	"PAN": "ABCDE1234F",
	"Driving Licence": "KA0120230012345",
	"Aadhar": "XXXXXXXXXXXX",
}


class GigWorkerUniqueIDSettings(Document):
	def validate(self):
		self.validate_id_proof_selection()
		self.validate_suffix()
		self.preview_format = self.get_preview_format()

	def validate_id_proof_selection(self):
		if not self.get_selected_proof_types():
			frappe.throw("Please select at least one ID proof to base the Unique ID on.")

	def validate_suffix(self):
		if self.suffix and not self.suffix.isdigit():
			frappe.throw("Suffix (Starting Running Number) must contain digits only, e.g. 001.")

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

		parts.extend(ID_PROOF_PLACEHOLDERS.get(proof_type, "") for proof_type in self.get_selected_proof_types())

		if self.suffix:
			parts.append(self.suffix)

		preview = "-".join(parts)

		if self.suffix and self.suffix.isdigit():
			next_suffix = str(int(self.suffix) + 1).zfill(len(self.suffix))
			preview += f"  (next: ...-{next_suffix})"

		return preview
