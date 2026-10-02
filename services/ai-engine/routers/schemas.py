"""Request models shared by the analysis routers."""
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class Segment(BaseModel):
    id: Optional[str] = None
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    text: Optional[str] = Field(default=None, max_length=20000)

    @model_validator(mode="after")
    def check_order(self):
        if self.endMs <= self.startMs:
            raise ValueError("endMs must be greater than startMs")
        return self
