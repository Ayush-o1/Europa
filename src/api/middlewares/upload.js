/**
 * @fileoverview Safe CSV Upload Middleware
 *
 * Configures Multer with memory storage, strict file size limits (10MB),
 * and filename/MIME-type validation for CelesTrak SOCRATES CSV files.
 */

import multer from 'multer';
import path from 'node:path';

const MAX_CSV_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/csv',
  'text/x-csv',
  'application/octet-stream', // Some clients send raw CSVs as octet-stream
]);

/**
 * Custom error for unsupported uploaded file types.
 */
export class UnsupportedMediaTypeError extends Error {
  constructor(message = 'Only CSV files (.csv) are supported for snapshot ingestion.') {
    super(message);
    this.name = 'UnsupportedMediaTypeError';
    this.statusCode = 415;
    this.code = 'UNSUPPORTED_MEDIA_TYPE';
  }
}

/**
 * Filter ensuring uploaded file is a valid CSV.
 */
function csvFileFilter(req, file, cb) {
  const extension = path.extname(file.originalname).toLowerCase();

  if (extension !== '.csv') {
    return cb(
      new UnsupportedMediaTypeError(
        `Invalid file extension '${extension}'. Only .csv files are accepted.`,
      ),
      false,
    );
  }

  if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
    return cb(
      new UnsupportedMediaTypeError(
        `Invalid MIME type '${file.mimetype}'. Only text/csv or equivalent formats are accepted.`,
      ),
      false,
    );
  }

  cb(null, true);
}

const storage = multer.memoryStorage();

export const uploadSnapshotCsv = multer({
  storage,
  limits: {
    fileSize: MAX_CSV_SIZE_BYTES,
    files: 1,
  },
  fileFilter: csvFileFilter,
});
