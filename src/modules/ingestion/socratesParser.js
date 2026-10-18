/**
 * @fileoverview CelesTrak SOCRATES CSV Parser & Validator
 * RFC 4180 compliant parser for official SOCRATES close-approach CSV files.
 */

import { Readable } from 'node:stream';
import csv from 'csv-parser';

/**
 * Maps SATCAT operational status codes found in brackets (e.g. '[+]') to normalized enum.
 * @param {string} rawName
 * @returns {{ cleanName: string, operationalStatus: string }}
 */
export function extractOperationalStatus(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return { cleanName: 'UNKNOWN', operationalStatus: 'UNKNOWN' };
  }

  const match = rawName.match(/\[([+\-P?BSX])\]/);
  if (!match) {
    return { cleanName: rawName.trim(), operationalStatus: 'UNKNOWN' };
  }

  const code = match[1];
  const cleanName = rawName.replace(/\[[+\-P?BSX]\]/, '').trim();

  const statusMap = {
    '+': 'OPERATIONAL',
    '-': 'NON_OPERATIONAL',
    P: 'PARTIALLY_OPERATIONAL',
    B: 'BACKUP_STANDBY',
    S: 'SPARE',
    X: 'EXTENDED_MISSION',
    '?': 'UNKNOWN',
  };

  return {
    cleanName,
    operationalStatus: statusMap[code] || 'UNKNOWN',
  };
}

/**
 * Normalizes UTC timestamp string from SOCRATES format (YYYY-MM-DD HH:MM:SS.sss) to ISO 8601 UTC string.
 * @param {string} rawTca
 * @returns {string | null}
 */
export function normalizeTcaTimestamp(rawTca) {
  if (!rawTca || typeof rawTca !== 'string') {
    return null;
  }
  const trimmed = rawTca.trim();
  // Handle space separator between date and time: '2026-10-18 19:19:25.010' -> '2026-10-18T19:19:25.010Z'
  const isoCandidate = trimmed.includes('T')
    ? trimmed.endsWith('Z')
      ? trimmed
      : `${trimmed}Z`
    : `${trimmed.replace(' ', 'T')}Z`;

  const date = new Date(isoCandidate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

/**
 * Parses and validates a single CSV row object.
 * @param {Record<string, string>} row
 * @param {number} rowIndex
 * @returns {{ valid: true, observation: object } | { valid: false, error: object }}
 */
export function validateSocratesRow(row, rowIndex) {
  // 1. Required header existence check
  const cat1Str = row.NORAD_CAT_ID_1?.trim();
  const cat2Str = row.NORAD_CAT_ID_2?.trim();
  const name1Str = row.OBJECT_NAME_1?.trim();
  const name2Str = row.OBJECT_NAME_2?.trim();
  const dse1Str = row.DSE_1?.trim();
  const dse2Str = row.DSE_2?.trim();
  const tcaStr = row.TCA?.trim();
  const rangeStr = row.TCA_RANGE?.trim();
  const speedStr = row.TCA_RELATIVE_SPEED?.trim();
  const maxProbStr = row.MAX_PROB?.trim();
  const dilutionStr = row.DILUTION?.trim();

  // Validate Catalog Numbers (Positive Integers, accommodates 6-digit IDs)
  if (!cat1Str || !/^\d+$/.test(cat1Str) || parseInt(cat1Str, 10) <= 0) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'INVALID_NORAD_CAT_ID_1',
        errorMessage: `NORAD_CAT_ID_1 must be a positive integer, got '${cat1Str}'`,
      },
    };
  }

  if (!cat2Str || !/^\d+$/.test(cat2Str) || parseInt(cat2Str, 10) <= 0) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'INVALID_NORAD_CAT_ID_2',
        errorMessage: `NORAD_CAT_ID_2 must be a positive integer, got '${cat2Str}'`,
      },
    };
  }

  const cat1 = parseInt(cat1Str, 10);
  const cat2 = parseInt(cat2Str, 10);

  if (cat1 === cat2) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'IDENTICAL_OBJECT_IDS',
        errorMessage: `Encounter cannot occur between identical catalog ID ${cat1}`,
      },
    };
  }

  // Validate Names
  if (!name1Str) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'MISSING_OBJECT_NAME_1',
        errorMessage: 'OBJECT_NAME_1 is required',
      },
    };
  }

  if (!name2Str) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'MISSING_OBJECT_NAME_2',
        errorMessage: 'OBJECT_NAME_2 is required',
      },
    };
  }

  // Validate DSE (Days Since Epoch >= 0)
  const dse1 = parseFloat(dse1Str);
  if (Number.isNaN(dse1) || dse1 < 0) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'INVALID_DSE_1',
        errorMessage: `DSE_1 must be a non-negative float, got '${dse1Str}'`,
      },
    };
  }

  const dse2 = parseFloat(dse2Str);
  if (Number.isNaN(dse2) || dse2 < 0) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'INVALID_DSE_2',
        errorMessage: `DSE_2 must be a non-negative float, got '${dse2Str}'`,
      },
    };
  }

  // Validate TCA
  const normalizedTca = normalizeTcaTimestamp(tcaStr);
  if (!normalizedTca) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'INVALID_TCA',
        errorMessage: `TCA must be a valid UTC timestamp, got '${tcaStr}'`,
      },
    };
  }

  // Validate TCA_RANGE (>= 0)
  const tcaRangeKm = parseFloat(rangeStr);
  if (Number.isNaN(tcaRangeKm) || tcaRangeKm < 0) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'INVALID_TCA_RANGE',
        errorMessage: `TCA_RANGE must be a non-negative float, got '${rangeStr}'`,
      },
    };
  }

  // Validate TCA_RELATIVE_SPEED (>= 0)
  const relativeSpeedKms = parseFloat(speedStr);
  if (Number.isNaN(relativeSpeedKms) || relativeSpeedKms < 0) {
    return {
      valid: false,
      error: {
        rowIndex,
        rawRow: row,
        errorCode: 'INVALID_RELATIVE_SPEED',
        errorMessage: `TCA_RELATIVE_SPEED must be a non-negative float, got '${speedStr}'`,
      },
    };
  }

  // Validate MAX_PROB (Nullable, 0.0 to 1.0, supports scientific notation)
  let maxProb = null;
  if (maxProbStr !== undefined && maxProbStr !== '') {
    maxProb = parseFloat(maxProbStr);
    if (Number.isNaN(maxProb) || maxProb < 0.0 || maxProb > 1.0) {
      return {
        valid: false,
        error: {
          rowIndex,
          rawRow: row,
          errorCode: 'INVALID_MAX_PROB',
          errorMessage: `MAX_PROB must be between 0.0 and 1.0, got '${maxProbStr}'`,
        },
      };
    }
  }

  // Validate DILUTION (Nullable, >= 0.0)
  let dilutionKm = null;
  if (dilutionStr !== undefined && dilutionStr !== '') {
    dilutionKm = parseFloat(dilutionStr);
    if (Number.isNaN(dilutionKm) || dilutionKm < 0.0) {
      return {
        valid: false,
        error: {
          rowIndex,
          rawRow: row,
          errorCode: 'INVALID_DILUTION',
          errorMessage: `DILUTION must be a non-negative float, got '${dilutionStr}'`,
        },
      };
    }
  }

  // Extract status and clean names
  const obj1Meta = extractOperationalStatus(name1Str);
  const obj2Meta = extractOperationalStatus(name2Str);

  // Canonical Object Normalization (min_id, max_id)
  const primaryNoradId = Math.min(cat1, cat2);
  const secondaryNoradId = Math.max(cat1, cat2);
  const canonicalPairKey = `${primaryNoradId}:${secondaryNoradId}`;

  const isObj1Primary = cat1 === primaryNoradId;
  const primaryObjectName = isObj1Primary ? obj1Meta.cleanName : obj2Meta.cleanName;
  const primaryOperationalStatus = isObj1Primary
    ? obj1Meta.operationalStatus
    : obj2Meta.operationalStatus;

  const secondaryObjectName = isObj1Primary ? obj2Meta.cleanName : obj1Meta.cleanName;
  const secondaryOperationalStatus = isObj1Primary
    ? obj2Meta.operationalStatus
    : obj1Meta.operationalStatus;

  const dsePrimary = isObj1Primary ? dse1 : dse2;
  const dseSecondary = isObj1Primary ? dse2 : dse1;

  return {
    valid: true,
    observation: {
      rowIndex,
      primaryNoradId,
      secondaryNoradId,
      primaryObjectName,
      primaryOperationalStatus,
      secondaryObjectName,
      secondaryOperationalStatus,
      canonicalPairKey,
      tca: normalizedTca,
      tcaRangeKm,
      relativeSpeedKms,
      maxProb,
      dilutionKm,
      dsePrimary,
      dseSecondary,
      sourceData: {
        rawRow: row,
        sourceNoradId1: cat1,
        sourceNoradId2: cat2,
        sourceObjectName1: name1Str,
        sourceObjectName2: name2Str,
        sourceDse1: dse1,
        sourceDse2: dse2,
      },
    },
  };
}

/**
 * Streams and parses a SOCRATES CSV from a Node.js Readable stream.
 * @param {Readable} stream
 * @returns {Promise<{ validRows: object[], errors: object[], totalRows: number }>}
 */
export async function parseSocratesCsvStream(stream) {
  return new Promise((resolve, reject) => {
    const validRows = [];
    const errors = [];
    let rowIndex = 0;

    stream
      .pipe(
        csv({
          mapHeaders: ({ header }) => header.trim(),
        }),
      )
      .on('data', row => {
        rowIndex += 1;
        const result = validateSocratesRow(row, rowIndex);
        if (result.valid) {
          validRows.push(result.observation);
        } else {
          errors.push(result.error);
        }
      })
      .on('end', () => {
        resolve({
          validRows,
          errors,
          totalRows: rowIndex,
        });
      })
      .on('error', err => {
        reject(new Error(`CSV parsing failed: ${err.message}`, { cause: err }));
      });
  });
}

/**
 * Parses SOCRATES CSV string or buffer.
 * @param {string | Buffer} content
 * @returns {Promise<{ validRows: object[], errors: object[], totalRows: number }>}
 */
export async function parseSocratesCsv(content) {
  const stream = Readable.from(content.toString('utf-8'));
  return parseSocratesCsvStream(stream);
}
