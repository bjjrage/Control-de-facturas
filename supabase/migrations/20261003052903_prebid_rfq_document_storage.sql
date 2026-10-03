-- The existing RFQ engine requires its original-document bucket on a fresh replay.
-- Existing environments keep their bucket settings intact.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('quote-pdfs','quote-pdfs',false,52428800,
 ARRAY['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv'])
 ON CONFLICT(id) DO NOTHING;
