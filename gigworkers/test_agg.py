import frappe

def execute():
    # Delete if exist to ensure clean slate
    if frappe.db.exists('User', 'newtestagg@example.com'):
        frappe.delete_doc('User', 'newtestagg@example.com', ignore_permissions=True)
    
    ag = frappe.db.get_value('Aggregator', {'email': 'newtestagg@example.com'}, 'name')
    if ag:
        frappe.delete_doc('Aggregator', ag, ignore_permissions=True)
        
    doc = frappe.get_doc({
        'doctype': 'Aggregator',
        'aggregator_name': 'Automated Test Aggregator',
        'email': 'newtestagg@example.com',
        'mobile': '7778889990',
        'pan': 'QWERT1234Y',
        'gstin': '07QWERT1234Y1Z5',
        'address': 'Test Address',
        'company_type': 'CIN',
        'brand_name': 'Test Brand'
    })
    doc.insert(ignore_permissions=True)
    print('Aggregator Inserted')
    
    user_exists = frappe.db.exists('User', 'newtestagg@example.com')
    print('User Created:', bool(user_exists))
    
    if user_exists:
        user_doc = frappe.get_doc('User', 'newtestagg@example.com')
        roles = [r.role for r in user_doc.roles]
        print('Assigned Roles:', roles)
        
    frappe.db.commit()
