-- Bucket rows are configuration data and were not included in the schema baseline.
-- Provision only the two RFQ document buckets. Never copy supplier or production data.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES
 ('quote-pdfs','quote-pdfs',false,20971520,ARRAY['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv']),
 ('rfq-attachments','rfq-attachments',false,20971520,ARRAY['application/pdf','image/png','image/jpeg'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
