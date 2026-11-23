/**
 * A small, deterministic PDF with named and explicit link destinations. Keeping
 * the fixture as ASCII source makes its annotations and xref offsets reviewable.
 * The pages deliberately have different dimensions to exercise PDF coordinates.
 */
export function createNavigationPdf(pageCount = 3) {
  const stream = (text: string) =>
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`
  const pages = [4, 6, 8].slice(0, pageCount)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Dests 3 0 R >>',
    `<< /Type /Pages /Kids [${pages.map(page => `${page} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /citation [8 0 R /XYZ 40 650 null] /equation [6 0 R /XYZ 40 500 null] /contents [4 0 R /XYZ 40 760 null] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 10 0 R >> >> /Contents 5 0 R /Annots [11 0 R 12 0 R 13 0 R 14 0 R] >>',
    stream(
      'BT /F1 16 Tf 40 750 Td (Navigation history) Tj 0 -40 Td (Citation) Tj 0 -40 Td (Equation) Tj 0 -40 Td (Figure) Tj 0 -40 Td (Contents) Tj ET'
    ),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 900] /Resources << /Font << /F1 10 0 R >> >> /Contents 7 0 R >>',
    stream('BT /F1 16 Tf 40 500 Td (Equation destination) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 1000] /Resources << /Font << /F1 10 0 R >> >> /Contents 9 0 R >>',
    stream(
      'BT /F1 16 Tf 40 650 Td (Bibliography destination) Tj 0 -300 Td (Figure destination) Tj ET'
    ),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Annot /Subtype /Link /Rect [40 700 190 725] /Border [0 0 0] /Dest /citation >>',
    '<< /Type /Annot /Subtype /Link /Rect [40 660 190 685] /Border [0 0 0] /A << /S /GoTo /D /equation >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [40 620 190 645] /Border [0 0 0] /Dest [8 0 R /XYZ 40 350 null] >>',
    '<< /Type /Annot /Subtype /Link /Rect [40 580 190 605] /Border [0 0 0] /Dest /contents >>',
  ]
  let pdf = '%PDF-1.7\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}
