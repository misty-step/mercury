export interface ResendSendRequest {
  to: string;
  subject: string;
  from: string;
  html?: string;
  text?: string;
}

export interface ResendSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  status?: number;
}

interface ResendSuccessResponse {
  id: string;
}

interface ResendErrorResponse {
  message?: string;
  name?: string;
}

function isResendSuccessResponse(value: unknown): value is ResendSuccessResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string';
}

function isResendErrorResponse(value: unknown): value is ResendErrorResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.message === 'string' || typeof record.name === 'string';
}

export async function sendEmail(
  apiKey: string,
  payload: ResendSendRequest
): Promise<ResendSendResult> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const rawBody = await response.text();
  let parsedBody: unknown = null;

  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      parsedBody = null;
    }
  }

  if (response.ok) {
    if (isResendSuccessResponse(parsedBody)) {
      return { success: true, messageId: parsedBody.id, status: response.status };
    }

    return {
      success: false,
      error: 'Resend response missing message id',
      status: response.status
    };
  }

  if (isResendErrorResponse(parsedBody)) {
    const errorParts = [parsedBody.name, parsedBody.message].filter(
      (part): part is string => typeof part === 'string' && part.length > 0
    );

    return {
      success: false,
      error: errorParts.join(': ') || 'Resend request failed',
      status: response.status
    };
  }

  return {
    success: false,
    error: `Resend request failed with status ${response.status}`,
    status: response.status
  };
}
