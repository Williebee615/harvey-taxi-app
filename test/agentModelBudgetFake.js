// JS stand-ins for the model budget database functions
// (migration 20261005010000), for server tests with the Supabase fake.
// Same rules: committed + open reservations + amount <= min(budget, 10);
// settle once, writing the ledger row. The real functions' atomicity
// under concurrency is tested against Postgres in
// test/db/agentModelBudget.db.test.js.
function modelBudgetRpc() {
  let nextId = 1;
  const sums = (state, month) => {
    const committed = (state.agent_model_usage || []).filter((r) => r.usage_month === month).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    const held = (state.agent_model_reservations || []).filter((r) => r.usage_month === month && !r.settled_at).reduce((s, r) => s + Number(r.amount_usd), 0);
    return { committed, held };
  };
  return {
    agent_model_reserve(args, state) {
      state.agent_model_reservations = state.agent_model_reservations || [];
      const { committed, held } = sums(state, args.p_month);
      const budget = Math.min(Number(args.p_budget_usd) || 0, 10);
      if (committed + held + Number(args.p_amount_usd) > budget + 1e-9) return { data: null, error: null };
      const id = nextId++;
      state.agent_model_reservations.push({ id, usage_month: args.p_month, amount_usd: Number(args.p_amount_usd), role: args.p_role, actor_id: args.p_actor_id, settled_at: null });
      return { data: id, error: null };
    },
    agent_model_settle(args, state) {
      const r = (state.agent_model_reservations || []).find((x) => x.id === args.p_reservation_id);
      if (!r || r.settled_at) return { data: false, error: null };
      r.settled_at = new Date().toISOString();
      state.agent_model_usage = state.agent_model_usage || [];
      state.agent_model_usage.push({
        usage_month: r.usage_month,
        role: args.p_role,
        actor_id: args.p_actor_id,
        app_target: args.p_app_target,
        model: args.p_model,
        calls: args.p_calls,
        input_tokens: args.p_input_tokens,
        output_tokens: args.p_output_tokens,
        cache_creation_input_tokens: args.p_cache_creation_input_tokens,
        cache_read_input_tokens: args.p_cache_read_input_tokens,
        cost_usd: args.p_cost_usd,
        outcome: args.p_outcome,
        reservation_id: r.id
      });
      return { data: true, error: null };
    },
    agent_model_month_totals(args, state) {
      const { committed, held } = sums(state, args.p_month);
      return { data: [{ committed_usd: committed, held_usd: held }], error: null };
    }
  };
}

module.exports = { modelBudgetRpc };
