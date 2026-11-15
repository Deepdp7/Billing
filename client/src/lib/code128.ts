/**
 * Code 128 barcodes (what every retail scanner reads). Digits-only codes of even length use set C (twice as dense);
 * everything else uses set B (printable ASCII). Returns bar/space widths in modules, starting with a bar.
 */

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const STOP = '2331112';
const START_B = 104;
const START_C = 105;

/** Whether text can be drawn as Code 128 here (printable ASCII, 1–48 characters). */
export const canEncode = (text: string) => /^[\x20-\x7e]{1,48}$/.test(text);

export function code128(text: string): number[] {
  if (!canEncode(text)) throw new Error('Barcode text must be 1–48 plain characters');
  const setC = /^\d+$/.test(text) && text.length % 2 === 0;
  const codes = setC
    ? [START_C, ...(text.match(/\d\d/g) || []).map(Number)]
    : [START_B, ...[...text].map((ch) => ch.charCodeAt(0) - 32)];
  const check = codes.reduce((sum, code, i) => sum + code * (i || 1), 0) % 103;
  return [...codes, check].map((c) => PATTERNS[c]).concat(STOP).join('').split('').map(Number);
}
