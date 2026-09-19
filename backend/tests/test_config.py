from theta import config


def test_parse_skips_blank_lines_and_comments():
    text = "\n# a comment\n   \nAI_MODEL=some-model-v1\n  # indented comment\n"
    assert config.parse_env(text) == {"AI_MODEL": "some-model-v1"}


def test_parse_strips_export_prefix_and_whitespace():
    assert config.parse_env("export  PORT = 5057 ") == {"PORT": "5057"}


def test_parse_strips_matching_quotes_only():
    text = "A='single'\nB=\"double\"\nC='mismatched\"\nD=plain"
    assert config.parse_env(text) == {"A": "single", "B": "double", "C": "'mismatched\"", "D": "plain"}


def test_parse_keeps_equals_and_colons_inside_values():
    text = ("TELEGRAM_BOT_TOKEN=123456:AA-bb_CC\n"
            "AI_API_ENDPOINT=https://example.test/apps/anthropic?x=1")
    assert config.parse_env(text) == {
        "TELEGRAM_BOT_TOKEN": "123456:AA-bb_CC",
        "AI_API_ENDPOINT": "https://example.test/apps/anthropic?x=1",
    }


def test_parse_ignores_lines_without_a_key():
    assert config.parse_env("just words\n=novalue\nOK=1") == {"OK": "1"}


def test_parse_allows_empty_value():
    assert config.parse_env("TELEGRAM_CHAT_ID=") == {"TELEGRAM_CHAT_ID": ""}


def test_load_sets_variables_and_returns_their_names(tmp_path):
    p = tmp_path / ".env"
    p.write_text("AI_API_KEY=sk-test\nAI_MODEL=m1\n")
    env = {}
    assert config.load_env_file(str(p), env) == ["AI_API_KEY", "AI_MODEL"]
    assert env == {"AI_API_KEY": "sk-test", "AI_MODEL": "m1"}


def test_load_never_overrides_the_shell(tmp_path):
    """A value exported in the shell wins, so one run can be overridden without editing .env."""
    p = tmp_path / ".env"
    p.write_text("PORT=5057\nAI_MODEL=m1\n")
    env = {"PORT": "8000"}
    assert config.load_env_file(str(p), env) == ["AI_MODEL"]
    assert env["PORT"] == "8000"


def test_load_missing_file_is_a_no_op(tmp_path):
    env = {}
    assert config.load_env_file(str(tmp_path / "nope.env"), env) == []
    assert env == {}
