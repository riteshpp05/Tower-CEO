"""AI Analyst chatbot for AIS CFO Ops Control Tower.

Hybrid architecture:
  - router.py      deterministic pattern -> RPC matching (zero hallucination
                    risk; numbers come straight from Supabase)
  - llm_tools.py    LLM tool-calling fallback for unmatched questions, with a
                    mechanical guardrail (_assert_no_invented_numbers) that
                    rejects any LLM-written number not present in tool results
  - chat_service.py orchestration + persistence + explicit ownership checks
                    (service role key bypasses RLS, so checks are re-done here)
  - chat_routes.py  FastAPI router to mount into cfo_server.py
  - auth.py         verifies the caller's Supabase JWT so user_id is real,
                    never a self-reported request field (see chat_routes.py)
  - supabase_client.py  thin REST wrapper using the service role key
"""
