import frappe
import json

def execute():
    try:
        def update_default_workspace(name, role, shortcuts):
            if not frappe.db.exists("Workspace", name):
                # Create the Workspace to override dynamic ones
                doc = frappe.get_doc({
                    "doctype": "Workspace",
                    "label": name,
                    "title": name,
                    "name": name,
                    "is_standard": 0,
                    "public": 1,
                    "roles": [{"role": role}],
                    "content": "[]" # Placeholder
                })
                doc.insert(ignore_permissions=True)
                
            doc = frappe.get_doc("Workspace", name)
                
            # Check if shortcut docs exist, create if not
            for lbl, link in shortcuts:
                if not frappe.db.get_value("Workspace Shortcut", {"label": lbl, "parent": name}):
                    s = frappe.get_doc({
                        "doctype": "Workspace Shortcut",
                        "label": lbl,
                        "type": "DocType",
                        "link_to": link,
                        "parent": name,
                        "parenttype": "Workspace",
                        "parentfield": "shortcuts"
                    })
                    s.flags.ignore_permissions = True
                    s.insert()
            
            # Add to child table
            existing = [s.label for s in doc.shortcuts]
            for lbl, link in shortcuts:
                if lbl not in existing:
                    doc.append("shortcuts", {
                        "label": lbl,
                        "type": "DocType",
                        "link_to": link
                    })
            
            # Also restore the links sidebar properties
            doc.flags.ignore_links = True
            doc.set("links", [])
            for lbl, link in shortcuts:
                doc.append("links", {"type": "Link", "label": lbl, "link_to": link, "link_type": "DocType"})
            
            # Build content
            content = [{"id": "h1", "type": "header", "data": {"text": f"<span class='h4'><b>{name}</b></span>", "col": 12}}]
            for i, (lbl, link) in enumerate(shortcuts):
                content.append({"id": f"s{i}", "type": "shortcut", "data": {"shortcut_name": lbl, "col": 4 if name=="Gig Workers" else 3}})
            doc.content = json.dumps(content)
            
            doc.save(ignore_permissions=True)
            print(f"Updated default {name} Workspace")

        update_default_workspace("Gig Workers", "Gig Worker", [("Gig Worker", "Gig Worker"), ("Gig Transaction", "Gig Transaction")])
        update_default_workspace("Aggregators", "Aggregator", [("Aggregator", "Aggregator"), ("Gig Worker", "Gig Worker"), ("Gig Transaction", "Gig Transaction"), ("Welfare Fee Payment", "Welfare Fee Payment")])
        
        frappe.db.commit()
    except Exception as e:
        print("Error creating workspaces:", e)
