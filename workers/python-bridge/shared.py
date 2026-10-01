"""Worker-side data helpers. Authoritative authorization stays in the parent."""
import json
from pydantic import BaseModel, ConfigDict


class Findings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    observations: list[str]
    evidence_ids: list[int]
    hypotheses: list[str]
    next_steps: list[str]
    limitations: str


def typed(text, enabled):
    return Findings.model_validate_json(text).model_dump() if enabled else None


def lifecycle(request, bridge):
    bridge.emit({'type':'lifecycle','event':'session.resumed' if request.get('native_state') else 'session.created'})


def arguments_model(schema, base=BaseModel, name='RelayArguments'):
    from pydantic import create_model, Field
    types = {'integer':int,'string':str,'boolean':bool,'array':list[int]}
    fields = {key:(types[value['type']],Field(description=value.get('description',key)))
              for key,value in schema['properties'].items()}
    return create_model(name,__base__=base,**fields)
