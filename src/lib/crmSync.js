import { BROKER_EMAIL_MAP, DEFAULT_BROKER_EMAIL } from './hrsConstants';

const CRM_API = 'https://crm.hrsinsurance.co.za/api';

async function checkDuplicate(headers, payload) {
  try {
    const res = await fetch(`${CRM_API}/clients-check-duplicate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const matches = data.duplicates ?? data.matches ?? (Array.isArray(data) ? data : null);
    return matches?.[0] ?? null;
  } catch {
    return null;
  }
}

async function createClient(headers, payload) {
  const res = await fetch(`${CRM_API}/clients?action=create`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn('CRM client create rejected:', JSON.stringify(data));
    throw new Error(`Client create failed: ${res.status} — ${JSON.stringify(data.issues || data.error || data)}`);
  }
  return data.id ?? data.client?.id ?? data.data?.id;
}

async function createDeal(headers, payload) {
  const res = await fetch(`${CRM_API}/deals?action=create`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn('CRM deal create rejected:', JSON.stringify(data));
    throw new Error(`Deal create failed: ${res.status} — ${JSON.stringify(data.issues || data.error || data)}`);
  }
  return data.id ?? data.deal?.id ?? data.data?.id;
}

/** Short, user-safe classification of a CRM sync failure — never the raw server body. */
function errorCodeFor(error) {
  const msg = String(error?.message || '');
  if (msg.startsWith('Client create failed')) return 'client_create_failed';
  if (msg.startsWith('Deal create failed')) return 'deal_create_failed';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || error?.name === 'TypeError') return 'network_error';
  return 'unknown_error';
}

/** User-safe message shown in the UI — the detailed server response stays in console.warn only. */
function safeErrorMessage(error) {
  switch (errorCodeFor(error)) {
    case 'client_create_failed':
      return 'The CRM rejected the client record. Please retry, or contact support if this continues.';
    case 'deal_create_failed':
      return 'The client was recorded, but the CRM rejected the deal record. Please retry.';
    case 'network_error':
      return 'Could not reach the CRM service. Please check your connection and retry.';
    default:
      return 'An unexpected error occurred while syncing to the CRM. Please retry.';
  }
}

export async function syncPersonalROAToCRM(formData, session, existing = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  };

  const clientName = [formData.initials, formData.surname].filter(Boolean).join(' ') || 'Unnamed';
  // Only send as a percentage if the fee type is actually 'percent'
  const brokerFeePercent = formData.brokerFeeType === 'percent'
    ? (Number(formData.brokerFeePercent) || undefined)
    : undefined;
  const estimatedPremium = Number(formData.prem2) || 0;

  // Retry support: if a previous attempt in this session already produced a deal, reuse
  // it outright rather than risking a second deal for the same submission.
  if (existing.dealId) {
    return { success: true, clientId: existing.clientId, dealId: existing.dealId };
  }

  // Client creation is attempted (and cached via `existing.clientId`) separately from deal
  // creation so a deal-creation failure never causes the client to be re-created on retry.
  let clientId = existing.clientId;
  if (!clientId) {
    try {
      const duplicate = await checkDuplicate(headers, {
        id_number: formData.idNumber,
        email: formData.email,
      });
      clientId = duplicate
        ? duplicate.id
        : await createClient(headers, {
          first_name: formData.firstName,
          surname: formData.surname,
          initials: formData.initials,
          client_name: clientName,
          id_number: formData.idNumber,
          email: formData.email,
          phone: formData.cell,
          street_address: [formData.streetNumber, formData.streetName].filter(Boolean).join(' '),
          complex_number: formData.complexName,
          suburb: formData.suburb,
          city: formData.city,
          province: formData.province,
          postal_code: formData.postalCode,
          proposed_insurer: formData.recInsurer,
          broker_name: formData.brokerName,
          assigned_broker: BROKER_EMAIL_MAP[formData.brokerName] ?? DEFAULT_BROKER_EMAIL,
          broker_commission_pct: brokerFeePercent,
          client_type: 'personal',
          status: 'prospect',
        });
    } catch (error) {
      console.warn('CRM sync failed (client):', error.message);
      return { success: false, clientId: null, error: safeErrorMessage(error), errorCode: errorCodeFor(error) };
    }
  }

  try {
    const dealId = await createDeal(headers, {
      client_id: clientId,
      client_name: clientName,
      policy_type: 'personal',
      estimated_premium: estimatedPremium,
      stage: 'lead_received',
      insurer: formData.recInsurer,
      broker_name: formData.brokerName,
      assigned_broker: BROKER_EMAIL_MAP[formData.brokerName] ?? DEFAULT_BROKER_EMAIL,
      contact_phone: formData.cell,
      contact_email: formData.email,
    });
    return { success: true, clientId, dealId };
  } catch (error) {
    console.warn('CRM sync failed (deal):', error.message);
    return { success: false, clientId, error: safeErrorMessage(error), errorCode: errorCodeFor(error) };
  }
}

export async function syncCommercialROAToCRM(formData, session, existing = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  };

  const clientName = formData.companyName || 'Unnamed';
  // Only send as a percentage if the fee type is actually 'percent'
  const brokerFeePercent = formData.brokerFeeType === 'percent'
    ? (Number(formData.brokerFeePercent) || undefined)
    : undefined;
  const estimatedPremium = Number(formData.prem2) || 0;

  // Retry support: if a previous attempt in this session already produced a deal, reuse
  // it outright rather than risking a second deal for the same submission.
  if (existing.dealId) {
    return { success: true, clientId: existing.clientId, dealId: existing.dealId };
  }

  // Client creation is attempted (and cached via `existing.clientId`) separately from deal
  // creation so a deal-creation failure never causes the client to be re-created on retry.
  let clientId = existing.clientId;
  if (!clientId) {
    try {
      const duplicate = await checkDuplicate(headers, {
        company_reg: formData.registrationNo,
        email: formData.email,
      });
      clientId = duplicate
        ? duplicate.id
        : await createClient(headers, {
          company_name: formData.companyName,
          client_name: clientName,
          contact_person: formData.contactPerson || [formData.contactFirstName, formData.contactSurname].filter(Boolean).join(' '),
          company_reg: formData.registrationNo,
          vat_number: formData.vatNo,
          email: formData.email,
          phone: formData.contactNo,
          street_address: [formData.streetNumber, formData.streetName].filter(Boolean).join(' '),
          complex_number: formData.complexName,
          suburb: formData.suburb,
          city: formData.city,
          province: formData.province,
          postal_code: formData.postalCode,
          broker_name: formData.brokerName,
          assigned_broker: BROKER_EMAIL_MAP[formData.brokerName] ?? DEFAULT_BROKER_EMAIL,
          broker_commission_pct: brokerFeePercent,
          client_type: 'commercial',
          status: 'prospect',
        });
    } catch (error) {
      console.warn('CRM sync failed (client):', error.message);
      return { success: false, clientId: null, error: safeErrorMessage(error), errorCode: errorCodeFor(error) };
    }
  }

  try {
    const dealId = await createDeal(headers, {
      client_id: clientId,
      client_name: clientName,
      policy_type: 'commercial',
      estimated_premium: estimatedPremium,
      stage: 'lead_received',
      insurer: formData.recInsurer,
      broker_name: formData.brokerName,
      assigned_broker: BROKER_EMAIL_MAP[formData.brokerName] ?? DEFAULT_BROKER_EMAIL,
      contact_phone: formData.contactNo,
      contact_email: formData.email,
    });
    return { success: true, clientId, dealId };
  } catch (error) {
    console.warn('CRM sync failed (deal):', error.message);
    return { success: false, clientId, error: safeErrorMessage(error), errorCode: errorCodeFor(error) };
  }
}
