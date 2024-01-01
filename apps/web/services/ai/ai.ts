import { getAPIUrl } from "@services/config/config";
import { RequestBody, RequestBodyWithAuthHeader } from "@services/utils/ts/requests";

export async function startActivityAIChatSession(message: string, activity_uuid: string) {
  const data = {
    message,
    activity_uuid,
  };
  const result = await fetch(`${getAPIUrl()}ai/start/activity_chat_session`, RequestBody("POST", data, null));
  const res = await result.json();
  return res;
}

export async function sendActivityAIChatMessage(message: string, aichat_uuid: string, activity_uuid: string) {
  const data = {
    aichat_uuid,
    message,
    activity_uuid,
  };
  const result = await fetch(`${getAPIUrl()}ai/send/activity_chat_message`, RequestBody("POST", data, null));
  const res = await result.json();
  return res;
}
