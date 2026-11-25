// PN e LID são espaços de identidade distintos. Só a metadata do participante
// pode associá-los; números iguais em domínios diferentes não provam identidade.
export function normalizeGroupUserJid(value, defaultDomain = null) {
  let jid = String(value || '').trim()
  if (defaultDomain && /^\d+$/u.test(jid)) jid = `${jid}@${defaultDomain}`
  const match = /^(\d+)(?::\d+)?@(lid|s\.whatsapp\.net)$/u.exec(jid)
  return match ? `${match[1]}@${match[2]}` : null
}

export function groupParticipantIds(participant) {
  return [...new Set([
    normalizeGroupUserJid(participant?.jid),
    normalizeGroupUserJid(participant?.id),
    normalizeGroupUserJid(participant?.lid, 'lid'),
    normalizeGroupUserJid(participant?.lidJid, 'lid'),
    normalizeGroupUserJid(participant?.phoneJid, 's.whatsapp.net'),
    normalizeGroupUserJid(participant?.phoneNumber, 's.whatsapp.net'),
    // Zapo pode devolver o PN com estes nomes, dependendo da versão do
    // metadata. Eles representam o mesmo participante e são necessários para
    // reconhecer o bot promovido quando a mensagem chega por LID.
    normalizeGroupUserJid(participant?.pn, 's.whatsapp.net'),
    normalizeGroupUserJid(participant?.phone, 's.whatsapp.net')
  ].filter(Boolean))]
}

export function findGroupParticipant(metadata, target) {
  const id = normalizeGroupUserJid(target)
  if (!id || !Array.isArray(metadata?.participants)) return null
  const matches = metadata.participants.filter(member => groupParticipantIds(member).includes(id))
  // Metadata ambígua não pode decidir uma remoção/promoção pelo primeiro match.
  return matches.length === 1 ? matches[0] : null
}

export function groupParticipantRole(participant) {
  if (!participant) return 'unknown'
  const role = String(
    participant.role
    || participant.type
    || participant.admin
    || participant.privilege
    || participant.rank
    || ''
  ).trim().toLowerCase().replace(/[-\s]/gu, '_')
  if (participant.isSuperAdmin === true || participant.isSuperAdmin === 1 || ['superadmin', 'super_admin', 'owner', 'creator'].includes(role)) return 'superadmin'
  if (participant.isAdmin === true || participant.isAdmin === 1 || role === 'admin') return 'admin'
  return 'member'
}
