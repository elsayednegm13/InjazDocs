-- An export operation has one commercial invoice and one live sea booking.
CREATE UNIQUE INDEX export_invoices_one_case_idx ON export_invoices(case_id);
CREATE UNIQUE INDEX bookings_one_open_case_idx ON bookings(case_id)
  WHERE case_id IS NOT NULL AND status != 'CANCELLED';
