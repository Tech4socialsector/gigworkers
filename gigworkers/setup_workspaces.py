import frappe
import json

def execute():
    try:
        def add_shortcuts(doc, shortcuts_list):
            existing = [s.label for s in doc.shortcuts]
            for label, link_to in shortcuts_list:
                if label not in existing:
                    doc.append("shortcuts", {
                        "label": label,
                        "type": "DocType",
                        "link_to": link_to
                    })

        # Gigworker Portal
        gw_name = "Gigworker Portal"
        if not frappe.db.exists("Workspace", gw_name):
            doc = frappe.get_doc({
                "doctype": "Workspace",
                "label": gw_name,
                "title": gw_name,
                "name": gw_name,
                "is_standard": 0,
                "public": 1,
                "roles": [{"role": "Gig Worker"}],
                "links": [
                    {"type": "Link", "label": "Gig Worker", "link_to": "Gig Worker", "link_type": "DocType"},
                    {"type": "Link", "label": "Gig Transaction", "link_to": "Gig Transaction", "link_type": "DocType"}
                ],
            })
            doc.insert(ignore_permissions=True)
        else:
            doc = frappe.get_doc("Workspace", gw_name)
            
        doc.flags.ignore_links = True
        doc.set("links", [])
        doc.append("links", {"type": "Link", "label": "Gig Worker", "link_to": "Gig Worker", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Gig Transaction", "link_to": "Gig Transaction", "link_type": "DocType"})

        doc.content = json.dumps([
            {"id": "h_gw", "type": "header", "data": {"text": "<span class='h4'><b>" + gw_name + "</b></span>", "col": 12}},
            {"id": "s_gw1", "type": "shortcut", "data": {"shortcut_name": "Gig Worker", "col": 4}},
            {"id": "s_gw2", "type": "shortcut", "data": {"shortcut_name": "Gig Transaction", "col": 4}}
        ])
        add_shortcuts(doc, [("Gig Worker", "Gig Worker"), ("Gig Transaction", "Gig Transaction")])
        doc.save(ignore_permissions=True)
        print(f"Updated '{gw_name}' Workspace.")

        # Aggregator Portal
        ag_name = "Aggregator Portal"
        if not frappe.db.exists("Workspace", ag_name):
            doc = frappe.get_doc({
                "doctype": "Workspace",
                "label": ag_name,
                "title": ag_name,
                "name": ag_name,
                "is_standard": 0,
                "public": 1,
                "roles": [{"role": "Aggregator"}],
                "links": [
                    {"type": "Link", "label": "Aggregator", "link_to": "Aggregator", "link_type": "DocType"},
                    {"type": "Link", "label": "Gig Worker", "link_to": "Gig Worker", "link_type": "DocType"},
                    {"type": "Link", "label": "Gig Transaction", "link_to": "Gig Transaction", "link_type": "DocType"},
                    {"type": "Link", "label": "Welfare Fee Payment", "link_to": "Welfare Fee Payment", "link_type": "DocType"}
                ],
            })
            doc.insert(ignore_permissions=True)
        else:
            doc = frappe.get_doc("Workspace", ag_name)
            
        doc.flags.ignore_links = True
        doc.set("links", [])
        doc.append("links", {"type": "Link", "label": "Aggregator", "link_to": "Aggregator", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Gig Worker", "link_to": "Gig Worker", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Gig Transaction", "link_to": "Gig Transaction", "link_type": "DocType"})
        doc.append("links", {"type": "Link", "label": "Welfare Fee Payment", "link_to": "Welfare Fee Payment", "link_type": "DocType"})
            
        doc.content = json.dumps([
            {"id": "h_ag", "type": "header", "data": {"text": "<span class='h4'><b>" + ag_name + "</b></span>", "col": 12}},
            {"id": "s_ag1", "type": "shortcut", "data": {"shortcut_name": "Aggregator", "col": 3}},
            {"id": "s_ag2", "type": "shortcut", "data": {"shortcut_name": "Gig Worker", "col": 3}},
            {"id": "s_ag3", "type": "shortcut", "data": {"shortcut_name": "Gig Transaction", "col": 3}},
            {"id": "s_ag4", "type": "shortcut", "data": {"shortcut_name": "Welfare Fee Payment", "col": 3}}
        ])
        add_shortcuts(doc, [
            ("Aggregator", "Aggregator"),
            ("Gig Worker", "Gig Worker"),
            ("Gig Transaction", "Gig Transaction"),
            ("Welfare Fee Payment", "Welfare Fee Payment")
        ])
        doc.save(ignore_permissions=True)
        print(f"Updated '{ag_name}' Workspace.")

        frappe.db.commit()
    except Exception as e:
        print("Error creating workspaces:", e)
