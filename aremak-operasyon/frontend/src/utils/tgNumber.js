// TeamGram CustomField sayı parse'ı.
// Number tipi CF'lerde TG iki alan döner:
//  - UnFormattedNumber: ham string (örn. "3600") — locale-bağımsız, kesin değer
//  - Value: locale formatlı gösterim (örn. "3,600" veya "3.600") — ambiguous
// Tutarlılık için her zaman UnFormattedNumber'ı tercih et; yoksa Value'yu
// heuristic ile parse et (kullanıcının elle girdiği değerler vs.).

// Fallback: locale formatlı stringi otomatik tespitle parse et.
// Son ayırıcı virgülse → TR ("26.007,23"), noktaysa → US ("26,007.23")
export const parseTgNumber = (val) => {
  if (val == null || val === '') return NaN
  const s = String(val).trim()
  const lastComma = s.lastIndexOf(',')
  const lastPeriod = s.lastIndexOf('.')
  if (lastComma === -1 && lastPeriod === -1) return parseFloat(s)
  if (lastComma > lastPeriod) return parseFloat(s.replace(/\./g, '').replace(',', '.'))
  return parseFloat(s.replace(/,/g, ''))
}

// CF objesinden sayıyı çek — UnFormattedNumber varsa onu kullan.
export const parseCfNumber = (cf) => {
  if (!cf) return NaN
  if (cf.UnFormattedNumber != null && cf.UnFormattedNumber !== '') {
    const n = parseFloat(cf.UnFormattedNumber)
    if (!isNaN(n)) return n
  }
  return parseTgNumber(cf.Value)
}
