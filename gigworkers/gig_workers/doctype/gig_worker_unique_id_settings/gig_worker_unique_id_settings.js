// Copyright (c) 2026, Jenifar and contributors
// For license information, please see license.txt

const ID_PROOF_PLACEHOLDERS = {
	"PAN": "ABCDE1234F",
	"Driving Licence": "KA0120230012345",
	"Aadhar": "XXXXXXXXXXXX",
};

function get_selected_proof_types(frm) {
	if (frm.doc.id_proof_mode === "Single ID Proof") {
		return frm.doc.id_proof_type ? [frm.doc.id_proof_type] : [];
	}

	let proof_types = [];
	if (frm.doc.allow_pan) proof_types.push("PAN");
	if (frm.doc.allow_driving_licence) proof_types.push("Driving Licence");
	if (frm.doc.allow_aadhar) proof_types.push("Aadhar");
	return proof_types;
}

function update_preview(frm) {
	let proof_types = get_selected_proof_types(frm);
	let parts = [];

	if (frm.doc.need_prefix && frm.doc.prefix) {
		parts.push(frm.doc.prefix);
	}

	proof_types.forEach((proof_type) => parts.push(ID_PROOF_PLACEHOLDERS[proof_type] || ""));

	if (frm.doc.suffix) {
		parts.push(frm.doc.suffix);
	}

	let preview = parts.join("-");

	if (frm.doc.suffix && /^\d+$/.test(frm.doc.suffix)) {
		let next_suffix = String(Number(frm.doc.suffix) + 1).padStart(frm.doc.suffix.length, "0");
		preview += `  (next: ...-${next_suffix})`;
	}

	frm.set_value("preview_format", preview);
}

frappe.ui.form.on("Gig Worker Unique ID Settings", {
	refresh(frm) {
		update_preview(frm);
	},
	id_proof_mode(frm) {
		update_preview(frm);
	},
	id_proof_type(frm) {
		update_preview(frm);
	},
	allow_pan(frm) {
		update_preview(frm);
	},
	allow_driving_licence(frm) {
		update_preview(frm);
	},
	allow_aadhar(frm) {
		update_preview(frm);
	},
	need_prefix(frm) {
		update_preview(frm);
	},
	prefix(frm) {
		update_preview(frm);
	},
	suffix(frm) {
		update_preview(frm);
	},
});
