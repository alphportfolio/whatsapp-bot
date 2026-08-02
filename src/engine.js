const { supabase } = require("./supabaseClient");
const { parseIncoming } = require("./whatsapp");
const { ownerSteps, finalizeOwnerOnboarding } = require("./flows/ownerOnboarding");
const { sendButtons } = require("./whatsapp");

// All step registries, keyed by flow name. Currently only owner onboarding is built;
// "tenant_onboarding" and "contact_flow" plug in here the same way later.
const FLOWS = {
  owner_onboarding: ownerSteps,
};

async function loadState(whatsapp_number) {
  const { data, error } = await supabase
    .from("conversation_state")
    .select("*")
    .eq("whatsapp_number", whatsapp_number)
    .maybeSingle();

  if (error) throw error;

  if (data) return data;

  // No row yet — create a fresh one
  const { data: created, error: insertError } = await supabase
    .from("conversation_state")
    .insert({ whatsapp_number, role: "unknown", flow_data: {} })
    .select()
    .single();

  if (insertError) throw insertError;
  return created;
}

async function saveState(whatsapp_number, patch) {
  const { error } = await supabase
    .from("conversation_state")
    .update(patch)
    .eq("whatsapp_number", whatsapp_number);

  if (error) throw error;
}

async function resetState(whatsapp_number) {
  await saveState(whatsapp_number, {
    role: "unknown",
    current_flow: null,
    current_step: null,
    flow_data: {},
    active_listing_id: null,
  });
}

// The very first message from any number always hits this, before any flow is chosen.
async function askWelcome(to) {
  await sendButtons(to, "👋 Welcome to Rentify! What would you like to do?", [
    { id: "list_house", title: "🏡 List My House" },
    { id: "find_house", title: "🔍 Find a House" },
  ]);
}

async function handleIncoming(from, message, displayName) {
  const state = await loadState(from);
  const incoming = parseIncoming(message);

  // No flow chosen yet -> this message should be the welcome button reply
  if (!state.current_flow) {
    if (incoming.type === "button" && incoming.value === "list_house") {
      const firstStep = ownerSteps["phone_verification"];
      await saveState(from, {
        role: "owner",
        current_flow: "owner_onboarding",
        current_step: "phone_verification",
        flow_data: { whatsapp_display_name: displayName || null },
      });
      await firstStep.ask(from, { whatsapp_display_name: displayName || null });
      return;
    }

    if (incoming.type === "button" && incoming.value === "find_house") {
      // Tenant onboarding not built yet — placeholder response
      await sendButtons(from, "Tenant search is coming very soon! For now, want to list a property instead?", [
        { id: "list_house", title: "🏡 List My House" },
      ]);
      return;
    }

    // Anything else at this point -> re-show the welcome prompt
    await askWelcome(from);
    return;
  }

  // Mid-flow: route to the current step's handler
  const steps = FLOWS[state.current_flow];
  const step = steps[state.current_step];

  if (!step) {
    // Unknown/corrupted step — reset gracefully rather than getting stuck
    await resetState(from);
    await askWelcome(from);
    return;
  }

  const parsed = step.parse(incoming, state.flow_data);

  if (!parsed.ok) {
    await require("./whatsapp").sendText(from, parsed.error || "Sorry, I didn't quite get that. Please try again.");
    await step.ask(from, state.flow_data);
    return;
  }

  const flowData = { ...state.flow_data };
  step.save(parsed.value, flowData);

  const nextStepId = step.next(flowData);

  if (nextStepId === "FINALIZE") {
    await saveState(from, { flow_data: flowData });
    await finalizeOwnerOnboarding(from, flowData);
    await resetState(from);
    return;
  }

  const nextStep = steps[nextStepId];
  await saveState(from, { current_step: nextStepId, flow_data: flowData });
  await nextStep.ask(from, flowData);
}

module.exports = { handleIncoming, askWelcome, resetState };
