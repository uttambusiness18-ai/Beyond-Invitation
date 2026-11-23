import "server-only";

import { getSupabaseAuthServerClient } from "@/lib/supabase/auth-server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { OrderHelpError, helpStatus, helpSubmission, helpTimestamp, helpUuid } from "@/lib/order-help-request";
import type { OrderHelpAdminRequest, OrderHelpRequest, OrderHelpStatus, OrderHelpTopic } from "@/lib/order-help-types";

const TABLE = "website_order_help_requests";
const COLUMNS = "id,order_id,topic,message,status,created_at,updated_at";
const ADMIN_COLUMNS = `${COLUMNS},order:website_orders!inner(id,customer_name,customer_email,customer_phone)`;
const PAGE_SIZE = 25;

type HelpRow = {
  id: string; order_id: string; topic: OrderHelpTopic; message: string;
  status: OrderHelpStatus; created_at: string; updated_at: string;
};
type AdminRow = HelpRow & {
  order: { id: string; customer_name: string; customer_email: string; customer_phone: string };
};

function present(row: HelpRow): OrderHelpRequest {
  return {
    id: row.id, orderId: row.order_id, topic: row.topic, message: row.message,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function presentAdmin(row: AdminRow): OrderHelpAdminRequest {
  return {
    ...present(row), orderReference: `Order #${row.order_id.slice(0, 8).toUpperCase()}`,
    customer: { name: row.order.customer_name, email: row.order.customer_email, phone: row.order.customer_phone },
  };
}

export async function createOrderHelpRequest(body: Record<string, unknown>): Promise<OrderHelpRequest> {
  const submission = helpSubmission(body);
  const auth = await getSupabaseAuthServerClient();
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) throw new OrderHelpError("Sign in to send an order help request.", 401);

  // RLS and an explicit ownership check; an email match never grants order access.
  const { data: order, error: orderError } = await auth.from("website_orders")
    .select("id,user_id").eq("id", submission.orderId).eq("user_id", user.id).maybeSingle();
  if (orderError) throw new Error("Order ownership could not be checked.");
  if (!order || order.user_id !== user.id || order.id !== submission.orderId) {
    throw new OrderHelpError("This order could not be found in your account.", 404);
  }

  const db = getSupabaseAdminClient();
  const { data, error } = await db.from(TABLE).insert({
    id: submission.requestId, order_id: submission.orderId, user_id: user.id,
    topic: submission.topic, message: submission.message,
  }).select(COLUMNS).single();
  if (!error && data) return present(data as HelpRow);
  if (error?.code !== "23505") throw new Error("Help request could not be saved.");

  // Retrying after a dropped response must return the original receipt, not create a second ticket.
  const { data: existing, error: existingError } = await db.from(TABLE)
    .select(COLUMNS).eq("id", submission.requestId).eq("user_id", user.id).maybeSingle();
  if (existingError) throw new Error("Help request receipt could not be checked.");
  if (!existing || existing.order_id !== submission.orderId || existing.topic !== submission.topic || existing.message !== submission.message) {
    throw new OrderHelpError("This request reference has already been used. Close the form and try again.", 409);
  }
  return present(existing as HelpRow);
}

function decodeCursor(cursor: string) {
  try {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return { createdAt: helpTimestamp(value.createdAt), id: helpUuid(value.id) };
  } catch {
    throw new OrderHelpError("This page reference is invalid. Refresh the help requests.");
  }
}

export async function listOrderHelpRequests(cursor?: string | null): Promise<{ requests: OrderHelpAdminRequest[]; nextCursor: string | null }> {
  const after = cursor ? decodeCursor(cursor) : null;
  let query = getSupabaseAdminClient().from(TABLE).select(ADMIN_COLUMNS)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1);
  if (after) {
    query = query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`);
  }
  const { data, error } = await query;
  if (error) throw new Error("Help requests could not be loaded.");
  const rows = (data ?? []) as unknown as AdminRow[];
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    requests: page.map(presentAdmin),
    nextCursor: rows.length > PAGE_SIZE && last
      ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString("base64url")
      : null,
  };
}

export async function updateOrderHelpRequest(orderIdValue: string, idValue: string, body: Record<string, unknown>): Promise<OrderHelpAdminRequest> {
  const orderId = helpUuid(orderIdValue);
  const id = helpUuid(idValue);
  const status = helpStatus(body.status);
  const expectedUpdatedAt = helpTimestamp(body.expectedUpdatedAt);
  const { data, error } = await getSupabaseAdminClient().from(TABLE)
    // Admin Order Help is accessible without a staff session. Clear the previous
    // actor so an anonymous update is never attributed to an earlier editor.
    .update({ status, updated_by: null })
    .eq("id", id).eq("order_id", orderId).eq("updated_at", expectedUpdatedAt)
    .select(ADMIN_COLUMNS).maybeSingle();
  if (error) throw new Error("Help request status could not be saved.");
  if (!data) throw new OrderHelpError("This request changed or is no longer available. Refresh before updating it.", 409);
  return presentAdmin(data as unknown as AdminRow);
}
