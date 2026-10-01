"""Blank inherited secrets when the Claude SDK merges its env over os.environ."""
import os
from store import DATA

SAFE = {'SystemRoot','WINDIR','PATH','TEMP','TMP','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR',
        'NODE_EXTRA_CA_CERTS','LANG','LC_ALL','ANTHROPIC_API_KEY'}


def claude_environment():
    # Explicit empty values override the SDK's inherited parent environment.
    env={key:value if key in SAFE else '' for key,value in os.environ.items()}
    home=DATA/'claude-home';home.mkdir(parents=True,exist_ok=True)
    env.update(HOME=str(home),USERPROFILE=str(home),CLAUDE_CONFIG_DIR=str(home/'.claude'))
    return env
