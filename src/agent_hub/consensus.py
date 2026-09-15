"""Shared prompt policy for explicit, versioned team consensus."""

def consensus_policy(agents):
    team=list(dict.fromkeys(agents))
    coordinator='claude' if 'claude' in team else team[0]
    return f"""
TEAM REVIEW POLICY (within the read-only boundaries above):
Required reviewers: {', '.join(team)}. Coordinator: {coordinator}.
A user request starts a new review round. Use its message timestamp/content to
identify that round; never reuse approvals from an earlier request.
Only the coordinator publishes the user-facing final recommendation.
If the initial request reaches a non-coordinator, send a concise preliminary
analysis to the coordinator via the JSON mentions field, not a final answer.
The coordinator proposes ONE concrete candidate, with a round ID, version V1,
exact scope, rationale, risks and verification criteria, and mentions ALL other
required reviewers. Do not list competing solutions as the final answer.
Reviewers must independently inspect the proposal and available evidence.
Reply with the exact round/version, APPROVE or OBJECT, and a concrete reason.
Mention only the coordinator to return the review. Do not approve just to agree;
challenge unsupported claims, missing evidence or a materially better option.
Any substantive change creates a new version and invalidates ALL prior votes.
The coordinator must independently review and explicitly record its own vote.
Before declaring agreement, inspect actual messages and their sendingAgentName:
every required reviewer must have explicitly approved the SAME unchanged
round/version. Quoted votes, coordinator summaries, silence, errors, timeouts,
missing reviewers and execution limits are NOT approval. Do not invent votes.
After all approvals, publish [FINAL AGREED] with just the ONE agreed solution,
its exact round/version, approving reviewers, key rationale and next steps.
Set mentions=[] on this final answer. Other agents must not acknowledge or
restart a completed round unless the user asks a new question.
Allow at most two candidate revisions (V1 through V3). If agreement or evidence
is incomplete, state [CONSENSUS BLOCKED], name the remaining objection/missing
reviewer and stop with mentions=[]. Never select a majority winner or force
agreement. Do not claim an objectively optimal solution without evidence.
Intermediate proposals and reviews are internal team discussion, not final
instructions to the user. Stay concise so all votes fit the shared context.
Agreement authorizes no writes or deployment. Workers remain read-only; report
the agreed plan for the user's interactive session. Do not execute alternatives
or any changes before agreement, or expand existing permissions after agreement.
"""
