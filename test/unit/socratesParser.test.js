import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  parseSocratesCsv,
  parseSocratesCsvStream,
  extractOperationalStatus,
  normalizeTcaTimestamp,
} from '../../src/modules/ingestion/socratesParser.js';
import { createReadStream } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '../fixtures');

describe('SOCRATES CSV Parser Unit Tests', () => {
  describe('Helper Functions', () => {
    it('extracts operational status codes and clean names correctly', () => {
      expect(extractOperationalStatus('ISS (ZARYA) [+]')).toEqual({
        cleanName: 'ISS (ZARYA)',
        operationalStatus: 'OPERATIONAL',
      });
      expect(extractOperationalStatus('FENGYUN 1C DEB [-]')).toEqual({
        cleanName: 'FENGYUN 1C DEB',
        operationalStatus: 'NON_OPERATIONAL',
      });
      expect(extractOperationalStatus('STARLINK-30526 [P]')).toEqual({
        cleanName: 'STARLINK-30526',
        operationalStatus: 'PARTIALLY_OPERATIONAL',
      });
      expect(extractOperationalStatus('COSMOS 1598 [?]')).toEqual({
        cleanName: 'COSMOS 1598',
        operationalStatus: 'UNKNOWN',
      });
      expect(extractOperationalStatus('TIANGONG')).toEqual({
        cleanName: 'TIANGONG',
        operationalStatus: 'UNKNOWN',
      });
    });

    it('normalizes SOCRATES space-separated timestamps to ISO 8601 UTC', () => {
      expect(normalizeTcaTimestamp('2026-10-18 19:19:25.010')).toBe('2026-10-18T19:19:25.010Z');
      expect(normalizeTcaTimestamp('2026-10-18T19:19:25.010Z')).toBe('2026-10-18T19:19:25.010Z');
      expect(normalizeTcaTimestamp('invalid-date')).toBeNull();
      expect(normalizeTcaTimestamp('')).toBeNull();
      expect(normalizeTcaTimestamp(null)).toBeNull();
    });
  });

  describe('Real-Format Sample Ingestion', () => {
    it('successfully parses real SOCRATES sample with 6-digit catalog numbers and scientific notation', async () => {
      const filePath = path.join(FIXTURES_DIR, 'socrates_real_sample.csv');
      const content = await fs.readFile(filePath, 'utf-8');

      const result = await parseSocratesCsv(content);

      expect(result.totalRows).toBe(4);
      expect(result.errors.length).toBe(0);
      expect(result.validRows.length).toBe(4);

      // Verify Row 1: STARLINK-30526 [P] (58006) vs STARLINK-36931 [+] (68000)
      const r1 = result.validRows[0];
      expect(r1.primaryNoradId).toBe(58006);
      expect(r1.secondaryNoradId).toBe(68000);
      expect(r1.canonicalPairKey).toBe('58006:68000');
      expect(r1.tca).toBe('2026-10-18T19:19:25.010Z');
      expect(r1.tcaRangeKm).toBe(0.012);
      expect(r1.relativeSpeedKms).toBe(1.239);
      expect(r1.maxProb).toBe(1.0);
      expect(r1.dilutionKm).toBe(0.0);
      expect(r1.dsePrimary).toBe(1.888);
      expect(r1.dseSecondary).toBe(2.206);

      // Verify Row 2: 6-digit catalog number 100283
      const r2 = result.validRows[1];
      expect(r2.primaryNoradId).toBe(58531);
      expect(r2.secondaryNoradId).toBe(100283);
      expect(r2.canonicalPairKey).toBe('58531:100283');
      expect(r2.secondaryObjectName).toBe('STARLINK-37980');
      expect(r2.secondaryOperationalStatus).toBe('OPERATIONAL');

      // Verify Row 3: Scientific notation MAX_PROB = 2.194E-01 (0.2194)
      const r3 = result.validRows[2];
      expect(r3.maxProb).toBeCloseTo(0.2194, 4);
      expect(r3.dilutionKm).toBeCloseTo(0.006, 4);
    });

    it('parses via streaming interface (parseSocratesCsvStream)', async () => {
      const filePath = path.join(FIXTURES_DIR, 'socrates_real_sample.csv');
      const stream = createReadStream(filePath);

      const result = await parseSocratesCsvStream(stream);

      expect(result.totalRows).toBe(4);
      expect(result.validRows.length).toBe(4);
      expect(result.errors.length).toBe(0);
    });
  });

  describe('Error Handling and Malformed Data', () => {
    it('accurately identifies invalid rows without crashing the batch', async () => {
      const filePath = path.join(FIXTURES_DIR, 'socrates_malformed_sample.csv');
      const content = await fs.readFile(filePath, 'utf-8');

      const result = await parseSocratesCsv(content);

      // Total 6 rows in malformed fixture
      expect(result.totalRows).toBe(6);
      expect(result.validRows.length).toBe(1); // Only the first row is valid
      expect(result.errors.length).toBe(5);

      // Row 1 is valid (ISS vs Fengyun)
      expect(result.validRows[0].primaryNoradId).toBe(25544);
      expect(result.validRows[0].secondaryNoradId).toBe(30580);

      // Check specific error codes
      const errorCodes = result.errors.map(e => e.errorCode);
      expect(errorCodes).toContain('INVALID_NORAD_CAT_ID_1'); // missing ID
      expect(errorCodes).toContain('INVALID_TCA_RANGE'); // negative range -5.2
      expect(errorCodes).toContain('INVALID_TCA'); // NOT_A_VALID_DATE
      expect(errorCodes).toContain('INVALID_MAX_PROB'); // > 1.0 (1.500E+00)
    });

    it('rejects rows with identical primary and secondary catalog IDs', async () => {
      const csvContent =
        'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
        '25544,ISS [+],0.5,25544,ISS [+],0.5,2026-10-21 14:30:15.000,0.8,14.8,1.0E-04,0.1\n';

      const res = await parseSocratesCsv(csvContent);
      expect(res.validRows.length).toBe(0);
      expect(res.errors[0].errorCode).toBe('IDENTICAL_OBJECT_IDS');
    });
  });
});
