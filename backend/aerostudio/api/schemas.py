"""Wire format. Mirrors frontend/src/lib/types.ts (camelCase JSON)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from aerostudio.geometry.naca import NacaParams


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True)


class Naca4(BaseModel):
    M: float = Field(ge=0, le=9.5)
    P: float = Field(ge=0, le=9.5)
    T: float = Field(gt=1, le=40)


class Naca5(BaseModel):
    L: float = Field(ge=0, le=6)
    P: float = Field(ge=0, le=12)
    Q: Literal[0, 1] = 0
    T: float = Field(gt=1, le=40)


class Design(Camel):
    family: Literal["4", "5"]
    naca4: Naca4
    naca5: Naca5
    aoa: float = Field(ge=-20, le=25)
    speed: float = Field(gt=1, le=150)

    def params(self) -> NacaParams:
        if self.family == "4":
            return NacaParams(family="4", M=self.naca4.M, P=self.naca4.P, T=self.naca4.T)
        return NacaParams(family="5", L=self.naca5.L, P=self.naca5.P, Q=self.naca5.Q, T=self.naca5.T)


CheckStatus = Literal["pass", "warn", "fail"]


class EnvelopeCheck(Camel):
    key: str
    label: str
    value: float
    min: float
    max: float
    status: CheckStatus
    message: Optional[str] = None


class MeshMorphInfo(Camel):
    base_case: str
    shape_distance: float
    max_surface_displacement: float
    min_cell_quality: float
    nodes: int
    status: CheckStatus
    messages: list[str] = []


class Uncertainty(Camel):
    cl: float
    cd: float
    ld: float


class SurfaceDistribution(Camel):
    x: list[float]
    cp_upper: list[float]
    cp_lower: list[float]


class Prediction(Camel):
    id: str
    design: Design
    reynolds: float
    mach: float
    cl: float
    cd: float
    cm: float
    ld: float
    cl_pressure: float
    cl_viscous: float
    cd_pressure: float
    cd_viscous: float
    uncertainty: Uncertainty
    envelope: list[EnvelopeCheck]
    mesh: MeshMorphInfo
    surface: SurfaceDistribution
    stalled: bool
    separated_fraction: float
    timing_ms: float
    model_version: str


class PredictRequest(Camel):
    design: Design
    ensemble: bool = True


class FieldRequest(Camel):
    design: Design
    window: Literal["near", "wake"] = "near"


class SweepRequest(Camel):
    design: Design
    aoa_start: float = Field(ge=-20, le=25)
    aoa_end: float = Field(ge=-20, le=25)
    aoa_step: float = Field(gt=0.09, le=10)


class PolarPoint(Camel):
    aoa: float
    cl: float
    cd: float
    cm: float
    ld: float
    cl_sigma: float
    cd_sigma: float
    stalled: bool


class EnvelopeRange(Camel):
    min: float
    max: float
    step: float


class Envelope(Camel):
    naca4: dict[str, EnvelopeRange]
    naca5: dict[str, EnvelopeRange]
    aoa: EnvelopeRange
    speed: EnvelopeRange
    provisional: bool


class ModelInfo(Camel):
    mode: Literal["mock", "live"] = "live"
    name: str
    version: str
    status: Literal["placeholder", "validated", "unvalidated", "unavailable"]
    checkpoint: Optional[str] = None
    detail: dict = {}


# ------------------------------------------------------------------ optimization
class VariableSpec(Camel):
    key: Literal["M", "P", "T", "L", "aoa"]
    label: str = ""
    unit: str = ""
    enabled: bool
    min: float
    max: float
    fixed: float


class Constraints(Camel):
    min_thickness: float = 0.0
    max_abs_cm: Optional[float] = None
    stay_in_envelope: bool = True


class OptimizationConfig(Camel):
    family: Literal["4", "5"]
    objective: Literal["max_ld", "min_cd_at_cl", "max_cl", "robust_ld", "pareto_ld_cl"]
    target_cl: float = 0.6
    robust_band: float = 2.0
    uncertainty_penalty: float = 0.0
    variables: list[VariableSpec]
    speed: float
    reflex: Literal[0, 1] = 0
    constraints: Constraints = Constraints()
    algorithm: Literal["ga", "nsga2"] = "ga"
    population_size: int = Field(ge=4, le=200)
    generations: int = Field(ge=1, le=200)
    seed: int = 7


class Candidate(Camel):
    design: Design
    x: list[float]
    cl: float
    cd: float
    cm: float
    ld: float
    objectives: list[float]
    violation: float
    feasible: bool
    rank: Optional[int] = None


class HistoryPoint(Camel):
    generation: int
    best: float
    mean: float


class GenerationUpdate(Camel):
    generation: int
    evaluations: int
    elapsed_ms: float
    best: Candidate
    population: list[Candidate]
    history: list[HistoryPoint]
    pareto: Optional[list[Candidate]] = None


class OptimizationResult(GenerationUpdate):
    top: list[Candidate]
    config: OptimizationConfig


class JobCreated(Camel):
    job_id: str
