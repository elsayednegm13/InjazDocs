INSERT INTO company_settings (id, exporter_display_name, timezone, incoterms_edition, max_upload_bytes, currency_default, updated_at)
VALUES ('default', 'Export Operations', 'Africa/Cairo', 'Incoterms 2020', 419430400, 'USD', datetime('now'));

INSERT INTO payment_term_types (code, name_en, name_ar, requires_due_days) VALUES
  ('TT', 'Telegraphic Transfer (T/T)', 'تحويل برقي', 1),
  ('LC', 'Letter of Credit (L/C)', 'اعتماد مستندي', 0),
  ('DP', 'Documents against Payment (D/P)', 'مستندات مقابل الدفع', 0),
  ('DA', 'Documents against Acceptance (D/A)', 'مستندات مقابل القبول', 1),
  ('OTHER', 'Other', 'أخرى', 0);

INSERT INTO ports (id, unlocode, name, country_code, is_custom, created_at) VALUES
  ('egaly', 'EGALY', 'Alexandria', 'EG', 0, datetime('now')),
  ('egdam', 'EGDAM', 'Damietta', 'EG', 0, datetime('now')),
  ('egsok', 'EGSOK', 'Sokhna', 'EG', 0, datetime('now')),
  ('egpsd', 'EGPSD', 'Port Said', 'EG', 0, datetime('now')),
  ('nlrtm', 'NLRTM', 'Rotterdam', 'NL', 0, datetime('now')),
  ('deham', 'DEHAM', 'Hamburg', 'DE', 0, datetime('now')),
  ('aedxb', 'AEDXB', 'Jebel Ali / Dubai', 'AE', 0, datetime('now')),
  ('itgoa', 'ITGOA', 'Genoa', 'IT', 0, datetime('now')),
  ('esbcn', 'ESBCN', 'Barcelona', 'ES', 0, datetime('now')),
  ('usnyc', 'USNYC', 'New York', 'US', 0, datetime('now'));

INSERT INTO permissions (key, description) VALUES
  ('dashboard.view', 'View operations dashboard'),
  ('customers.view', 'View customers'),
  ('customers.create', 'Create customers'),
  ('customers.edit', 'Edit customers'),
  ('customers.bank_details.view', 'View customer bank details'),
  ('customers.bank_details.edit', 'Edit customer bank details'),
  ('export_cases.view_all', 'View all export cases'),
  ('export_cases.view_assigned', 'View assigned export cases'),
  ('export_cases.create', 'Create export cases'),
  ('export_cases.edit', 'Edit export cases'),
  ('export_cases.close', 'Close export cases'),
  ('export_cases.reopen', 'Reopen export cases'),
  ('invoices.view', 'View invoices'),
  ('invoices.edit', 'Edit invoices'),
  ('documents.view', 'View documents'),
  ('documents.upload', 'Upload documents'),
  ('documents.review', 'Review documents'),
  ('documents.manage_types', 'Manage document types and templates'),
  ('bank.view', 'View bank submissions'),
  ('bank.manage', 'Manage bank submissions'),
  ('courier.view', 'View courier shipments'),
  ('courier.manage', 'Manage courier shipments'),
  ('bookings.view', 'View bookings'),
  ('bookings.manage', 'Manage bookings'),
  ('containers.view', 'View containers'),
  ('containers.manage', 'Manage containers'),
  ('reminders.view', 'View reminders'),
  ('reminders.manage_own', 'Snooze and acknowledge own reminders'),
  ('reminders.manage_rules', 'Manage reminder rules'),
  ('tracking_links.manage', 'Manage customer tracking links'),
  ('reports.view', 'View reports'),
  ('reports.export', 'Export reports and CSV'),
  ('users.manage', 'Manage users'),
  ('roles.manage', 'Manage roles and permissions'),
  ('settings.manage', 'Manage company settings and custom fields'),
  ('audit.view', 'View audit history');

INSERT INTO roles (id, key, name_en, name_ar, is_system, created_at, updated_at) VALUES
  ('role-admin', 'administrator', 'Administrator', 'مدير النظام', 1, datetime('now'), datetime('now')),
  ('role-ops', 'operations_manager', 'Operations Manager', 'مدير العمليات', 1, datetime('now'), datetime('now')),
  ('role-officer', 'export_officer', 'Export Officer', 'موظف تصدير', 1, datetime('now'), datetime('now')),
  ('role-viewer', 'viewer', 'Viewer', 'عرض فقط', 1, datetime('now'), datetime('now'));

INSERT INTO role_permissions (role_id, permission_key)
SELECT 'role-admin', key FROM permissions;

INSERT INTO role_permissions (role_id, permission_key) VALUES
  ('role-ops', 'dashboard.view'),
  ('role-ops', 'customers.view'),
  ('role-ops', 'customers.create'),
  ('role-ops', 'customers.edit'),
  ('role-ops', 'customers.bank_details.view'),
  ('role-ops', 'export_cases.view_all'),
  ('role-ops', 'export_cases.create'),
  ('role-ops', 'export_cases.edit'),
  ('role-ops', 'export_cases.close'),
  ('role-ops', 'export_cases.reopen'),
  ('role-ops', 'invoices.view'),
  ('role-ops', 'invoices.edit'),
  ('role-ops', 'documents.view'),
  ('role-ops', 'documents.upload'),
  ('role-ops', 'documents.review'),
  ('role-ops', 'bank.view'),
  ('role-ops', 'bank.manage'),
  ('role-ops', 'courier.view'),
  ('role-ops', 'courier.manage'),
  ('role-ops', 'bookings.view'),
  ('role-ops', 'bookings.manage'),
  ('role-ops', 'containers.view'),
  ('role-ops', 'containers.manage'),
  ('role-ops', 'reminders.view'),
  ('role-ops', 'reminders.manage_own'),
  ('role-ops', 'tracking_links.manage'),
  ('role-ops', 'reports.view'),
  ('role-ops', 'reports.export'),
  ('role-ops', 'audit.view'),
  ('role-officer', 'dashboard.view'),
  ('role-officer', 'customers.view'),
  ('role-officer', 'customers.create'),
  ('role-officer', 'customers.edit'),
  ('role-officer', 'export_cases.view_assigned'),
  ('role-officer', 'export_cases.create'),
  ('role-officer', 'export_cases.edit'),
  ('role-officer', 'invoices.view'),
  ('role-officer', 'invoices.edit'),
  ('role-officer', 'documents.view'),
  ('role-officer', 'documents.upload'),
  ('role-officer', 'courier.view'),
  ('role-officer', 'courier.manage'),
  ('role-officer', 'bookings.view'),
  ('role-officer', 'bookings.manage'),
  ('role-officer', 'containers.view'),
  ('role-officer', 'containers.manage'),
  ('role-officer', 'reminders.view'),
  ('role-officer', 'reminders.manage_own'),
  ('role-officer', 'tracking_links.manage'),
  ('role-viewer', 'dashboard.view'),
  ('role-viewer', 'customers.view'),
  ('role-viewer', 'export_cases.view_assigned'),
  ('role-viewer', 'invoices.view'),
  ('role-viewer', 'documents.view'),
  ('role-viewer', 'courier.view'),
  ('role-viewer', 'bookings.view'),
  ('role-viewer', 'containers.view'),
  ('role-viewer', 'reminders.view'),
  ('role-viewer', 'reports.view');

INSERT INTO document_type_definitions (id, key, name_en, name_ar, active) VALUES
  ('dt-coo', 'certificate_of_origin', 'Certificate of Origin', 'شهادة المنشأ', 1),
  ('dt-bl', 'bill_of_lading', 'Bill of Lading', 'بوليصة الشحن', 1),
  ('dt-ci', 'commercial_invoice', 'Commercial Invoice', 'فاتورة تجارية', 1),
  ('dt-pl', 'packing_list', 'Packing List', 'قائمة التعبئة', 1),
  ('dt-tc', 'technical_certificate', 'Technical Certificate', 'شهادة فنية', 1),
  ('dt-pc', 'professional_certificate', 'Professional/Other Certificate', 'شهادة مهنية / أخرى', 1),
  ('dt-bcl', 'bank_cover_letter', 'Bank Cover Letter', 'خطاب تغطية بنكي', 1),
  ('dt-bc', 'booking_confirmation', 'Booking Confirmation', 'تأكيد الحجز', 1);

INSERT INTO document_template_sets (id, name_en, name_ar, is_default, created_at)
VALUES ('tpl-standard', 'Standard export set', 'مجموعة تصدير قياسية', 1, datetime('now'));

INSERT INTO document_template_items (id, template_id, document_type_id, required) VALUES
  ('ti-1', 'tpl-standard', 'dt-ci', 1),
  ('ti-2', 'tpl-standard', 'dt-pl', 1),
  ('ti-3', 'tpl-standard', 'dt-coo', 1),
  ('ti-4', 'tpl-standard', 'dt-bl', 0),
  ('ti-5', 'tpl-standard', 'dt-bc', 0);

INSERT INTO reminder_rule_definitions (
  id, family, name_en, name_ar, enabled, scope, offset_amount, offset_direction, offset_unit,
  day_policy, condition_key, recipient, priority, mandatory, created_at
) VALUES
  ('rr-doc-due', 'DOCUMENT_REQUIREMENT_NOT_READY', 'Document not ready', 'مستند غير جاهز', 1, 'COMPANY', 0, 'AFTER', 'DAYS', 'CALENDAR', 'DOCUMENT_NOT_READY', 'ASSIGNEE', 'HIGH', 1, datetime('now')),
  ('rr-review', 'DOCUMENT_REVIEW_PENDING', 'Document review pending', 'مراجعة مستند معلّقة', 1, 'COMPANY', 1, 'AFTER', 'DAYS', 'CALENDAR', 'DOCUMENT_REVIEW_PENDING', 'ASSIGNEE', 'NORMAL', 1, datetime('now')),
  ('rr-bank', 'BANK_REVIEW_OVERDUE', 'Bank review overdue', 'مراجعة البنك متأخرة', 1, 'COMPANY', 3, 'AFTER', 'DAYS', 'CALENDAR', 'BANK_REVIEW_PENDING', 'ASSIGNEE', 'HIGH', 1, datetime('now')),
  ('rr-courier', 'COURIER_STATUS_CHECK', 'Courier status check', 'متابعة الشحنة البريدية', 1, 'COMPANY', 2, 'AFTER', 'DAYS', 'CALENDAR', 'COURIER_IN_TRANSIT', 'ASSIGNEE', 'NORMAL', 0, datetime('now')),
  ('rr-load', 'BOOKING_LOADING_APPROACHING', 'Loading approaching', 'موعد التحميل قريب', 1, 'COMPANY', 2, 'BEFORE', 'DAYS', 'CALENDAR', 'LOADING_APPROACHING', 'ASSIGNEE', 'HIGH', 1, datetime('now')),
  ('rr-cutoff', 'BOOKING_CUTOFF_APPROACHING', 'Cutoff approaching', 'موعد الإغلاق قريب', 1, 'COMPANY', 1, 'BEFORE', 'DAYS', 'CALENDAR', 'CUTOFF_APPROACHING', 'ASSIGNEE', 'HIGH', 1, datetime('now')),
  ('rr-etd', 'BOOKING_ETD_FOLLOWUP', 'Departure follow-up', 'متابعة المغادرة', 1, 'COMPANY', 1, 'AFTER', 'DAYS', 'CALENDAR', 'ETD_FOLLOWUP', 'ASSIGNEE', 'NORMAL', 1, datetime('now')),
  ('rr-ctr', 'CONTAINER_STATUS_FOLLOWUP', 'Container follow-up', 'متابعة الحاوية', 1, 'COMPANY', 2, 'AFTER', 'DAYS', 'CALENDAR', 'CONTAINER_FOLLOWUP', 'ASSIGNEE', 'NORMAL', 0, datetime('now')),
  ('rr-eta', 'VESSEL_ETA_APPROACHING', 'ETA approaching', 'موعد الوصول قريب', 1, 'COMPANY', 2, 'BEFORE', 'DAYS', 'CALENDAR', 'ETA_APPROACHING', 'ASSIGNEE', 'NORMAL', 1, datetime('now')),
  ('rr-arr', 'ARRIVAL_OVERDUE', 'Arrival overdue', 'الوصول متأخر', 1, 'COMPANY', 0, 'AFTER', 'DAYS', 'CALENDAR', 'ARRIVAL_OVERDUE', 'ASSIGNEE', 'HIGH', 1, datetime('now')),
  ('rr-goods', 'GOODS_DELIVERY_PENDING', 'Goods delivery pending', 'تسليم البضاعة معلّق', 1, 'COMPANY', 3, 'AFTER', 'DAYS', 'CALENDAR', 'GOODS_DELIVERY_PENDING', 'ASSIGNEE', 'HIGH', 1, datetime('now'));
