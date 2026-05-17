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
  if (!res.ok) throw new Error(`Client create failed: ${res.status}`);
  const data = await res.json();
  return data.id ?? data.client?.id ?? data.data?.id;
}

async function createDeal(headers, payload) {
  const res = await fetch(`${CRM_API}/deals?action=create`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Deal create failed: ${res.status}`);
  const data = await res.json();
  return data.id ?? data.deal?.id ?? data.data?.id;
}

export async function syncPersonalROAToCRM(formData, session) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    };

    const clientName = [formData.initials, formData.surname].filter(Boolean).join(' ') || 'Unnamed';
    const brokerFeePercent = Number(formData.brokerFeePercent) || undefined;
    const estimatedPremium = Number(formData.prem2) || 0;

    const duplicate = await checkDuplicate(headers, {
      id_number: formData.idNumber,
      email: formData.email,
    });

    let clientId;
    if (duplicate) {
      clientId = duplicate.id;
    } else {
      clientId = await createClient(headers, {
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
    }

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
    console.warn('CRM sync failed:', error.message);
    return { success: false, error: error.message };
  }
}

export async function syncCommercialROAToCRM(formData, session) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    };

    const clientName = formData.companyName || 'Unnamed';
    const brokerFeePercent = Number(formData.brokerFeePercent) || undefined;
    const estimatedPremium = Number(formData.prem2) || 0;

    const duplicate = await checkDuplicate(headers, {
      company_reg: formData.registrationNo,
      email: formData.email,
    });

    let clientId;
    if (duplicate) {
      clientId = duplicate.id;
    } else {
      clientId = await createClient(headers, {
        company_name: formData.companyName,
        client_name: clientName,
        contact_person: formData.contactPerson,
        company_reg: formData.registrationNo,
        vat_number: formData.vatNo,
        email: formData.email,
        phone: formData.contactNo,
        street_address: formData.riskAddress,
        broker_name: formData.brokerName,
        assigned_broker: BROKER_EMAIL_MAP[formData.brokerName] ?? DEFAULT_BROKER_EMAIL,
        broker_commission_pct: brokerFeePercent,
        client_type: 'commercial',
        status: 'prospect',
      });
    }

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
    console.warn('CRM sync failed:', error.message);
    return { success: false, error: error.message };
  }
}
