import frappe

def get_user_roles(user):
	if not user:
		user = frappe.session.user
	return frappe.get_roles(user)

def is_admin(user):
	roles = get_user_roles(user)
	# Using count or just in
	return "Administrator" in roles or "System Manager" in roles

def get_aggregator_name(user):
	if not user:
		user = frappe.session.user
	return frappe.db.get_value("Aggregator", {"email": user}, "name")

def get_gig_worker_name(user):
	if not user:
		user = frappe.session.user
	return frappe.db.get_value("Gig Worker", {"user": user}, "name")

# --- Gig Worker ---
def gig_worker_query(user=None):
	if not user:
		user = frappe.session.user
	if is_admin(user): return ""
	
	roles = get_user_roles(user)
	conditions = []
	
	if "Aggregator" in roles:
		agg_name = get_aggregator_name(user)
		if agg_name:
			conditions.append(f"`tabGig Worker`.created_by_aggregator = '{agg_name}'")
	
	if "Gig Worker" in roles:
		conditions.append(f"`tabGig Worker`.user = '{user}'")
		
	if conditions:
		return "(" + " OR ".join(conditions) + ")"
	
	return "1=0"

def gig_worker_has_permission(doc, ptype=None, user=None):
	if not user:
		user = frappe.session.user
	if is_admin(user): return True
	
	roles = get_user_roles(user)
	
	if "Aggregator" in roles:
		agg_name = get_aggregator_name(user)
		if agg_name and doc.created_by_aggregator == agg_name:
			return True
			
	if "Gig Worker" in roles:
		if doc.user == user:
			return True
			
	return False

# --- Aggregator ---
def aggregator_query(user=None):
	if not user:
		user = frappe.session.user
	if is_admin(user): return ""
	
	roles = get_user_roles(user)
	conditions = []
	
	if "Aggregator" in roles:
		conditions.append(f"`tabAggregator`.email = '{user}'")
		
	if "Gig Worker" in roles:
		gw_name = get_gig_worker_name(user)
		if gw_name:
			agg_name = frappe.db.get_value("Gig Worker", gw_name, "created_by_aggregator")
			if agg_name:
				conditions.append(f"`tabAggregator`.name = '{agg_name}'")
				
	if conditions:
		return "(" + " OR ".join(conditions) + ")"
		
	return "1=0"

def aggregator_has_permission(doc, ptype=None, user=None):
	if not user:
		user = frappe.session.user
	if is_admin(user): return True
	
	roles = get_user_roles(user)
	
	if "Aggregator" in roles:
		if doc.email == user:
			return True
			
	if "Gig Worker" in roles:
		gw_name = get_gig_worker_name(user)
		if gw_name:
			agg_name = frappe.db.get_value("Gig Worker", gw_name, "created_by_aggregator")
			if agg_name and doc.name == agg_name:
				return True
				
	return False

# --- Gig Transaction ---
def transaction_query(user=None):
	if not user:
		user = frappe.session.user
	if is_admin(user): return ""
	
	roles = get_user_roles(user)
	conditions = []
	
	if "Aggregator" in roles:
		agg_name = get_aggregator_name(user)
		if agg_name:
			conditions.append(f"`tabGig Transaction`.aggregator = '{agg_name}'")
			
	if "Gig Worker" in roles:
		gw_name = get_gig_worker_name(user)
		if gw_name:
			conditions.append(f"`tabGig Transaction`.gig_worker = '{gw_name}'")
			
	if conditions:
		return "(" + " OR ".join(conditions) + ")"
		
	return "1=0"

def transaction_has_permission(doc, ptype=None, user=None):
	if not user:
		user = frappe.session.user
	if is_admin(user): return True
	
	roles = get_user_roles(user)
	
	if "Aggregator" in roles:
		agg_name = get_aggregator_name(user)
		if agg_name and doc.aggregator == agg_name:
			return True
			
	if "Gig Worker" in roles:
		gw_name = get_gig_worker_name(user)
		if gw_name and doc.gig_worker == gw_name:
			return True
			
	return False

# --- Welfare Fee Payment ---
def payment_query(user=None):
	if not user:
		user = frappe.session.user
	if is_admin(user): return ""
	
	roles = get_user_roles(user)
	conditions = []
	
	if "Aggregator" in roles:
		agg_name = get_aggregator_name(user)
		if agg_name:
			conditions.append(f"`tabWelfare Fee Payment`.aggregator = '{agg_name}'")
			
	if conditions:
		return "(" + " OR ".join(conditions) + ")"
		
	return "1=0"

def payment_has_permission(doc, ptype=None, user=None):
	if not user:
		user = frappe.session.user
	if is_admin(user): return True
	
	roles = get_user_roles(user)
	
	if "Aggregator" in roles:
		agg_name = get_aggregator_name(user)
		if agg_name and doc.aggregator == agg_name:
			return True
			
	return False
