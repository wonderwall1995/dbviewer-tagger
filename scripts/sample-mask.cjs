// Web 견본 CSV에서 공개하면 안 되는 값을 가린다. (make-samples.cjs가 쓴다)
const SECRET_MASK = '■■■■■■■■■...'
const SECRET_COLUMNS = new Set(['password', 'token_hash'])
const PHONE_COLUMNS = new Set(['phoneNumber', 'phone_number'])
// 머리글, 제약, 타입 행
const META_ROWS = 3

// 전화번호의 뒤쪽 두 묶음에서 앞 두 자리만 남긴다. 010-1234-5678 → 010-12■■-56■■
// 구분 기호 없이 적힌 휴대전화(01012345678)는 먼저 나눈다. 모르는 모양이면 숫자를 모두 가린다.
function maskPhone(value) {
  const text = value.trim()
  const mobile = /^(01\d)(\d{3,4})(\d{4})$/.exec(text)
  const shaped = mobile ? `${mobile[1]}-${mobile[2]}-${mobile[3]}` : text
  const m = /^(\+\d{1,3} \d{1,3}-|\(\d{2,3}\) |\d{2,3}-)(\d{3,4})-(\d{4})$/.exec(shaped)
  if (!m) return text.replace(/\d/g, '■')
  const hide = (digits) => digits.slice(0, 2) + '■'.repeat(digits.length - 2)
  return `${m[1]}${hide(m[2])}-${hide(m[3])}`
}

// rows를 그 자리에서 바꾼다. 가릴 열이 있으면 true.
function maskCsvRows(rows) {
  let touched = false
  rows[0].forEach((column, i) => {
    const mask = SECRET_COLUMNS.has(column) ? () => SECRET_MASK : PHONE_COLUMNS.has(column) ? maskPhone : null
    if (!mask) return
    touched = true
    for (const row of rows.slice(META_ROWS)) if (row[i]) row[i] = mask(row[i])
  })
  return touched
}

module.exports = { SECRET_MASK, SECRET_COLUMNS, PHONE_COLUMNS, META_ROWS, maskPhone, maskCsvRows }
