/**
 * @fileoverview Two-Line Element (TLE) Format Validator & Parser
 *
 * Implements strict NORAD / CelesTrak TLE standard verification, including line lengths,
 * line prefixes, catalog number consistency, modulo-10 checksum validation, and epoch decoding.
 */

/**
 * Computes modulo-10 checksum for a 69-character TLE line.
 * Numbers add their value, minus signs count as 1, all other characters count as 0.
 *
 * @param {string} line
 * @returns {number} Modulo-10 checksum digit (0-9)
 */
export function computeTleChecksum(line) {
  let sum = 0;
  const len = Math.min(line.length, 68);
  for (let i = 0; i < len; i++) {
    const char = line[i];
    if (char >= '0' && char <= '9') {
      sum += parseInt(char, 10);
    } else if (char === '-') {
      sum += 1;
    }
  }
  return sum % 10;
}

/**
 * Decodes standard TLE epoch (year + fractional day of year) into UTC Date.
 * NORAD convention: 2-digit years < 57 represent 2000-2056, >= 57 represent 1957-1999.
 *
 * @param {string} line1
 * @returns {Date}
 */
export function parseTleEpoch(line1) {
  const yearStr = line1.substring(18, 20).trim();
  const dayOfYearStr = line1.substring(20, 32).trim();

  const yy = parseInt(yearStr, 10);
  if (Number.isNaN(yy)) {
    throw new Error(`Invalid TLE epoch year: "${yearStr}"`);
  }

  const dayOfYear = parseFloat(dayOfYearStr);
  if (Number.isNaN(dayOfYear) || dayOfYear < 1 || dayOfYear > 367) {
    throw new Error(`Invalid TLE day of year: "${dayOfYearStr}"`);
  }

  const fullYear = yy < 57 ? 2000 + yy : 1900 + yy;
  const baseDate = new Date(Date.UTC(fullYear, 0, 1));
  const epochMs = baseDate.getTime() + (dayOfYear - 1) * 86400 * 1000;
  return new Date(epochMs);
}

/**
 * Validates and parses a Two-Line Element (TLE) pair.
 *
 * @param {string} rawLine1 - First line of TLE
 * @param {string} rawLine2 - Second line of TLE
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   data: {
 *     catalogNumber: number,
 *     epoch: Date,
 *     inclinationDeg: number,
 *     eccentricity: number,
 *     raanDeg: number,
 *     argPerigeeDeg: number,
 *     meanAnomalyDeg: number,
 *     meanMotionRevDay: number,
 *     bstar: number,
 *     rawLine1: string,
 *     rawLine2: string
 *   } | null
 * }}
 */
export function validateTle(rawLine1, rawLine2) {
  const errors = [];

  if (typeof rawLine1 !== 'string' || typeof rawLine2 !== 'string') {
    return {
      valid: false,
      errors: ['TLE inputs must be strings.'],
      data: null,
    };
  }

  const line1 = rawLine1.trim();
  const line2 = rawLine2.trim();

  // 1. Length validation (exactly 69 chars)
  if (line1.length !== 69) {
    errors.push(`TLE Line 1 must be exactly 69 characters (received ${line1.length}).`);
  }
  if (line2.length !== 69) {
    errors.push(`TLE Line 2 must be exactly 69 characters (received ${line2.length}).`);
  }

  // 2. Line number prefix
  if (!line1.startsWith('1 ')) {
    errors.push(`TLE Line 1 must start with "1 ".`);
  }
  if (!line2.startsWith('2 ')) {
    errors.push(`TLE Line 2 must start with "2 ".`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }

  // 3. Catalog Number matching between Line 1 and Line 2
  const cat1Str = line1.substring(2, 7).trim();
  const cat2Str = line2.substring(2, 7).trim();
  const cat1 = parseInt(cat1Str, 10);
  const cat2 = parseInt(cat2Str, 10);

  if (Number.isNaN(cat1) || cat1 <= 0) {
    errors.push(`TLE Line 1 contains invalid NORAD catalog number: "${cat1Str}".`);
  }
  if (Number.isNaN(cat2) || cat2 <= 0) {
    errors.push(`TLE Line 2 contains invalid NORAD catalog number: "${cat2Str}".`);
  }
  if (cat1 !== cat2) {
    errors.push(`TLE catalog number mismatch between Line 1 (${cat1Str}) and Line 2 (${cat2Str}).`);
  }

  // 4. Checksums
  const expectedCheck1 = parseInt(line1[68], 10);
  const actualCheck1 = computeTleChecksum(line1);
  if (actualCheck1 !== expectedCheck1) {
    errors.push(
      `TLE Line 1 checksum failure: computed ${actualCheck1}, expected ${expectedCheck1}.`,
    );
  }

  const expectedCheck2 = parseInt(line2[68], 10);
  const actualCheck2 = computeTleChecksum(line2);
  if (actualCheck2 !== expectedCheck2) {
    errors.push(
      `TLE Line 2 checksum failure: computed ${actualCheck2}, expected ${expectedCheck2}.`,
    );
  }

  // 5. Epoch parsing
  let epoch = null;
  try {
    epoch = parseTleEpoch(line1);
  } catch (err) {
    errors.push(err.message);
  }

  // 6. Orbital parameters on Line 2
  const inc = parseFloat(line2.substring(8, 16).trim());
  const raan = parseFloat(line2.substring(17, 25).trim());
  const eccRaw = line2.substring(26, 33).trim();
  const ecc = parseFloat(`0.${eccRaw}`);
  const argP = parseFloat(line2.substring(34, 42).trim());
  const m = parseFloat(line2.substring(43, 51).trim());
  const mm = parseFloat(line2.substring(52, 63).trim());

  if (Number.isNaN(inc) || inc < 0 || inc > 180) {
    errors.push(`Invalid orbital inclination: ${inc}° (must be between 0° and 180°).`);
  }
  if (Number.isNaN(ecc) || ecc < 0 || ecc >= 1) {
    errors.push(`Invalid orbital eccentricity: ${ecc} (must be between 0 and 1).`);
  }
  if (Number.isNaN(mm) || mm <= 0) {
    errors.push(`Invalid mean motion: ${mm} rev/day (must be positive).`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, data: null };
  }

  return {
    valid: true,
    errors: [],
    data: {
      catalogNumber: cat1,
      epoch,
      inclinationDeg: inc,
      eccentricity: ecc,
      raanDeg: raan,
      argPerigeeDeg: argP,
      meanAnomalyDeg: m,
      meanMotionRevDay: mm,
      rawLine1: line1,
      rawLine2: line2,
    },
  };
}
