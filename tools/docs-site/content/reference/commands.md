
# Edit commands (ctx.edit)

Every single edit a script may send with `ctx.edit`, read from the kernel's own schemas and those of the add-ons in force: 204 commands. The kit functions build these for you; reach for a command directly only when no kit function fits.

| Command | From |
| --- | --- |
| [`accept_derived_zone`](#accept_derived_zone) | kernel |
| [`add_architecture`](#add_architecture) | kernel |
| [`add_construction_stage`](#add_construction_stage) | kernel |
| [`add_drawing_item`](#add_drawing_item) | kernel |
| [`add_field_block`](#add_field_block) | kernel |
| [`add_link_members`](#add_link_members) | kernel |
| [`add_local_rule`](#add_local_rule) | kernel |
| [`add_question`](#add_question) | kernel |
| [`add_submittal`](#add_submittal) | kernel |
| [`answer_question`](#answer_question) | kernel |
| [`assign_elements_to_group`](#assign_elements_to_group) | kernel |
| [`attach_part_to_load_point`](#attach_part_to_load_point) | kernel |
| [`auto_connect_runs`](#auto_connect_runs) | kernel |
| [`calibrate_underlay`](#calibrate_underlay) | kernel |
| [`change_elevation`](#change_elevation) | kernel |
| [`clear_classification`](#clear_classification) | kernel |
| [`clear_group_typical`](#clear_group_typical) | kernel |
| [`connect_into`](#connect_into) | kernel |
| [`connect_runs`](#connect_runs) | kernel |
| [`copy_drawing_items`](#copy_drawing_items) | kernel |
| [`copy_elements`](#copy_elements) | kernel |
| [`create_3d_view`](#create_3d_view) | kernel |
| [`create_ceiling`](#create_ceiling) | kernel |
| [`create_element`](#create_element) | kernel |
| [`create_element_type`](#create_element_type) | kernel |
| [`create_elements`](#create_elements) | kernel |
| [`create_group`](#create_group) | kernel |
| [`create_hosted`](#create_hosted) | kernel |
| [`create_level`](#create_level) | kernel |
| [`create_load`](#create_load) | kernel |
| [`create_load_point`](#create_load_point) | kernel |
| [`create_mounting_plane`](#create_mounting_plane) | kernel |
| [`create_phase`](#create_phase) | kernel |
| [`create_phase_filter`](#create_phase_filter) | kernel |
| [`create_service_link`](#create_service_link) | kernel |
| [`create_sheet`](#create_sheet) | kernel |
| [`create_space`](#create_space) | kernel |
| [`create_tag_style`](#create_tag_style) | kernel |
| [`create_text_note`](#create_text_note) | kernel |
| [`create_text_style`](#create_text_style) | kernel |
| [`create_view`](#create_view) | kernel |
| [`create_zone`](#create_zone) | kernel |
| [`decline_question`](#decline_question) | kernel |
| [`delete_catalog_entry`](#delete_catalog_entry) | kernel |
| [`delete_ceilings`](#delete_ceilings) | kernel |
| [`delete_construction_stage`](#delete_construction_stage) | kernel |
| [`delete_drawing_item`](#delete_drawing_item) | kernel |
| [`delete_elements`](#delete_elements) | kernel |
| [`delete_group`](#delete_group) | kernel |
| [`delete_load_points`](#delete_load_points) | kernel |
| [`delete_local_rules`](#delete_local_rules) | kernel |
| [`delete_phase`](#delete_phase) | kernel |
| [`delete_phase_filter`](#delete_phase_filter) | kernel |
| [`delete_questions`](#delete_questions) | kernel |
| [`delete_sheet`](#delete_sheet) | kernel |
| [`delete_spaces`](#delete_spaces) | kernel |
| [`delete_stacks`](#delete_stacks) | add-on |
| [`delete_tag_style`](#delete_tag_style) | kernel |
| [`delete_text_note`](#delete_text_note) | kernel |
| [`delete_text_style`](#delete_text_style) | kernel |
| [`delete_underlays`](#delete_underlays) | kernel |
| [`delete_view`](#delete_view) | kernel |
| [`delete_zones`](#delete_zones) | kernel |
| [`demolish_elements`](#demolish_elements) | kernel |
| [`detach_part_from_load_point`](#detach_part_from_load_point) | kernel |
| [`disconnect_run`](#disconnect_run) | kernel |
| [`drag_run`](#drag_run) | kernel |
| [`duplicate_view`](#duplicate_view) | kernel |
| [`edit_ceiling`](#edit_ceiling) | kernel |
| [`edit_construction_stage`](#edit_construction_stage) | kernel |
| [`edit_field_block`](#edit_field_block) | kernel |
| [`edit_load_point`](#edit_load_point) | kernel |
| [`edit_local_rule`](#edit_local_rule) | kernel |
| [`edit_question`](#edit_question) | kernel |
| [`edit_schedule`](#edit_schedule) | kernel |
| [`edit_service_link`](#edit_service_link) | kernel |
| [`edit_space`](#edit_space) | kernel |
| [`edit_stack`](#edit_stack) | add-on |
| [`edit_text_note`](#edit_text_note) | kernel |
| [`edit_underlay`](#edit_underlay) | kernel |
| [`edit_zone`](#edit_zone) | kernel |
| [`elbow_to_tee`](#elbow_to_tee) | kernel |
| [`ensure_starter_level`](#ensure_starter_level) | kernel |
| [`forward_question`](#forward_question) | kernel |
| [`freeze_stage`](#freeze_stage) | kernel |
| [`insert_library_view`](#insert_library_view) | kernel |
| [`join_parts`](#join_parts) | kernel |
| [`lock_elements`](#lock_elements) | kernel |
| [`lock_group`](#lock_group) | kernel |
| [`make_ceiling_from_space_height`](#make_ceiling_from_space_height) | kernel |
| [`make_spaces_from_rooms`](#make_spaces_from_rooms) | kernel |
| [`merge_space_children`](#merge_space_children) | kernel |
| [`move_elements`](#move_elements) | kernel |
| [`move_equipment`](#move_equipment) | kernel |
| [`move_line_end`](#move_line_end) | kernel |
| [`move_load`](#move_load) | kernel |
| [`move_tag`](#move_tag) | kernel |
| [`move_text_note`](#move_text_note) | kernel |
| [`move_viewport`](#move_viewport) | kernel |
| [`move_wall`](#move_wall) | kernel |
| [`name_stacks`](#name_stacks) | add-on |
| [`offset_run`](#offset_run) | kernel |
| [`pin_firm_discipline`](#pin_firm_discipline) | kernel |
| [`place_devices`](#place_devices) | kernel |
| [`place_part`](#place_part) | kernel |
| [`place_planned_part`](#place_planned_part) | kernel |
| [`place_run_accessory`](#place_run_accessory) | kernel |
| [`place_service_layout`](#place_service_layout) | add-on |
| [`place_space_in_walls`](#place_space_in_walls) | kernel |
| [`place_underlay`](#place_underlay) | kernel |
| [`place_viewport`](#place_viewport) | kernel |
| [`plan_part`](#plan_part) | kernel |
| [`record_determination`](#record_determination) | kernel |
| [`record_divergence`](#record_divergence) | kernel |
| [`record_finding_disposition`](#record_finding_disposition) | kernel |
| [`remove_link_members`](#remove_link_members) | kernel |
| [`remove_viewport`](#remove_viewport) | kernel |
| [`rename_view`](#rename_view) | kernel |
| [`reorder_construction_stages`](#reorder_construction_stages) | kernel |
| [`reply_question`](#reply_question) | kernel |
| [`reposition_service_links`](#reposition_service_links) | kernel |
| [`resize_riser`](#resize_riser) | kernel |
| [`resize_run`](#resize_run) | kernel |
| [`resize_stretch`](#resize_stretch) | kernel |
| [`resize_text_note`](#resize_text_note) | kernel |
| [`resize_viewport`](#resize_viewport) | kernel |
| [`restore_document_elements`](#restore_document_elements) | kernel |
| [`review_submittal`](#review_submittal) | kernel |
| [`rotate_elements`](#rotate_elements) | kernel |
| [`route_flex`](#route_flex) | kernel |
| [`route_into_flex`](#route_into_flex) | kernel |
| [`route_run`](#route_run) | kernel |
| [`save_catalog_entry`](#save_catalog_entry) | kernel |
| [`save_connection_type`](#save_connection_type) | kernel |
| [`save_part_types`](#save_part_types) | kernel |
| [`set_3d_crop_box`](#set_3d_crop_box) | kernel |
| [`set_3d_view_camera`](#set_3d_view_camera) | kernel |
| [`set_active_group`](#set_active_group) | kernel |
| [`set_active_phase`](#set_active_phase) | kernel |
| [`set_classification`](#set_classification) | kernel |
| [`set_construction_stage`](#set_construction_stage) | kernel |
| [`set_element_class`](#set_element_class) | kernel |
| [`set_element_linked_copy`](#set_element_linked_copy) | kernel |
| [`set_element_phases`](#set_element_phases) | kernel |
| [`set_element_placement`](#set_element_placement) | kernel |
| [`set_element_thickness`](#set_element_thickness) | kernel |
| [`set_element_type`](#set_element_type) | kernel |
| [`set_element_values`](#set_element_values) | kernel |
| [`set_fitting_coefficient`](#set_fitting_coefficient) | kernel |
| [`set_group_typical`](#set_group_typical) | kernel |
| [`set_level_linked_storey`](#set_level_linked_storey) | kernel |
| [`set_load_allocation_policy`](#set_load_allocation_policy) | kernel |
| [`set_model_addon`](#set_model_addon) | kernel |
| [`set_mounting_plane`](#set_mounting_plane) | kernel |
| [`set_parameters`](#set_parameters) | kernel |
| [`set_part_clearances`](#set_part_clearances) | kernel |
| [`set_part_host`](#set_part_host) | kernel |
| [`set_pipe_insulation`](#set_pipe_insulation) | add-on |
| [`set_pipe_sizes`](#set_pipe_sizes) | kernel |
| [`set_print_black_only`](#set_print_black_only) | kernel |
| [`set_project_origin`](#set_project_origin) | kernel |
| [`set_project_parameters`](#set_project_parameters) | kernel |
| [`set_question_status`](#set_question_status) | kernel |
| [`set_requirement_state`](#set_requirement_state) | kernel |
| [`set_run_insulation`](#set_run_insulation) | add-on |
| [`set_sheet_properties`](#set_sheet_properties) | kernel |
| [`set_slope`](#set_slope) | kernel |
| [`set_stack_checks`](#set_stack_checks) | add-on |
| [`set_stage_plan`](#set_stage_plan) | kernel |
| [`set_survey_point`](#set_survey_point) | kernel |
| [`set_system_design`](#set_system_design) | kernel |
| [`set_system_graphics`](#set_system_graphics) | kernel |
| [`set_tag_text`](#set_tag_text) | kernel |
| [`set_terminal_cfm`](#set_terminal_cfm) | add-on |
| [`set_true_north`](#set_true_north) | kernel |
| [`set_typical_cap`](#set_typical_cap) | kernel |
| [`set_view_crop`](#set_view_crop) | kernel |
| [`set_view_properties`](#set_view_properties) | kernel |
| [`set_viewport_north_arrow`](#set_viewport_north_arrow) | kernel |
| [`set_viewport_scale`](#set_viewport_scale) | kernel |
| [`set_viewport_title`](#set_viewport_title) | kernel |
| [`set_working_angle`](#set_working_angle) | kernel |
| [`slide_branch`](#slide_branch) | kernel |
| [`split_load`](#split_load) | kernel |
| [`split_load_point`](#split_load_point) | kernel |
| [`split_run`](#split_run) | kernel |
| [`split_space`](#split_space) | kernel |
| [`stretch_to_side`](#stretch_to_side) | kernel |
| [`supersede_determination`](#supersede_determination) | kernel |
| [`swap_fitting`](#swap_fitting) | kernel |
| [`sync_levels`](#sync_levels) | kernel |
| [`take_over_question`](#take_over_question) | kernel |
| [`undemolish_elements`](#undemolish_elements) | kernel |
| [`undo`](#undo) | kernel |
| [`unlock_elements`](#unlock_elements) | kernel |
| [`unpin_firm_discipline`](#unpin_firm_discipline) | kernel |
| [`unplace_part`](#unplace_part) | kernel |
| [`update_drawing_item`](#update_drawing_item) | kernel |
| [`update_group`](#update_group) | kernel |
| [`update_level`](#update_level) | kernel |
| [`update_phase`](#update_phase) | kernel |
| [`update_phase_filter`](#update_phase_filter) | kernel |
| [`update_tag_style`](#update_tag_style) | kernel |
| [`update_text_style`](#update_text_style) | kernel |

## accept_derived_zone

- zoneId: string
- hostId: string
- rule?: string
- name?: string
- purpose?: "thermal"|"ventilation"|"electrical_load_region"|"fire_area"|"smoke"|"lighting_control"|"sprinkler_hazard"|"structural_load_area"|"drainage_catchment"|"code_clearance" | string | string

## add_architecture

- levelId: string
- walls?: &#123; wallId: string; start: &#123; x: number; y: number &#125;; end: &#123; x: number; y: number &#125;; thicknessMm: number; heightMm?: number; wallType?: string &#125;[]
- openings?: &#123; openingId: string; wallId: string; kind: "door"|"window"; offsetMm: number; widthMm: number; heightMm?: number; mark?: string &#125;[]
- rooms?: &#123; roomId: string; number: string; name: string; outline: &#123; x: number; y: number &#125;[] &#125;[]
- casework?: &#123; componentId: string; typeName: string; position: &#123; x: number; y: number &#125;; size: &#123; x: number; y: number &#125;; rotationDeg?: number &#125;[]

## add_construction_stage

- stageId: string
- name: string
- order?: number
- zoneIds?: string[]
- classIds?: string[]
- plannedStart?: string
- plannedFinish?: string

## add_drawing_item

- itemId: string
- ownerId: string
- shape: "text"|"line"|"rect"|"cloud"|"dimension"|"tag"|"arc"|"circle"|"polyline"|"spline"|"region"|"component"|"repeat"|"batt"|"callout"|"figure"|"field_block"
- points: &#123; x: number; y: number &#125;[]
- text?: string
- textSize?: number
- dim?: &#123; kind: "linear"|"aligned"|"angular"|"radial"|"diameter"|"arc_length"|"spot_elevation"|"spot_coordinate"; direction?: "horizontal"|"vertical"; chain?: "continuous"|"baseline"; refs?: &#123; elementId: string; anchor: "start"|"end"|"mid"|"center"|"insertion"|"edge_left"|"edge_right"; index?: number &#125; | null[]; offsetMm: number; textOverride?: string; prefix?: string; suffix?: string; style?: &#123; units?: "ft_in"|"in"|"mm"|"m"; roundTo?: number; terminator?: "tick"|"arrow"|"dot"; textSizeMm?: number &#125; &#125;
- tag?: &#123; elementId: string; template: "auto"|"duct_size"|"duct_size_insulation"|"pipe_size"|"pipe_size_insulation"|"mark"|"air_terminal"|"equipment"|"fixture"|"fields"|"gas_pipe"|"name_number"; fields?: string[]; leader: boolean; leaderOverride?: boolean; mask?: boolean; textSizeMm?: number; styleId?: string; elbow?: "auto" | &#123; x: number; y: number &#125; &#125;
- callout?: &#123; viewId: string; label?: string &#125;
- lineStyle?: &#123; weight?: "thin"|"medium"|"wide"|"heavy"; pattern?: "solid"|"dashed"|"hidden"|"center"|"phantom"|"dotted" &#125;
- closed?: boolean
- ccw?: boolean
- fill?: &#123; pattern: "solid"|"diagonal"|"diagonal_reverse"|"crosshatch"|"horizontal"|"vertical"|"dots"|"concrete"|"earth"|"insulation_rigid"|"masonry"; spacingMm?: number; grey?: number; masking?: boolean; boundary?: boolean &#125;
- component?: &#123; symbolId: string; widthMm?: number; heightMm?: number; rotationDeg?: number; mirror?: boolean; spacingMm?: number &#125;
- batt?: &#123; thicknessMm: number &#125;
- category?: "detail_lines"|"hatching"|"masking"|"components"|"insulation"|"text"|"dimensions"|"tags"|"clouds"
- detailGroup?: string
- pinned?: boolean
- figure?: &#123; kind: "chart"; chart: string; params?: object; title?: string &#125; | &#123; kind: "image"; image: &#123; fileId: string; name: string; mime: "image/png"|"image/jpeg" &#125; &#125;

## add_field_block

- itemId: string
- sheetId: string
- at: &#123; x: number; y: number &#125;
- block: &#123; template: string; subjectId?: string; title?: string; table?: &#123; kind: "ventilation"|"pressurization"|"gas"; scope: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; &#125; | &#123; kind: "keynotes"; sheetId: string; table: &#123;…&#125; &#125;; calc?: &#123; template: string; options?: object &#125; &#125;
- textSize?: number

## add_link_members

- linkId: string
- members: &#123; elementId: string; connector?: string &#125;[]

## add_local_rule

- rule: object

## add_question

- questions: &#123; questionId: string; type?: "question"|"assumption"|"field_verify"; number?: string; text: string; askOf: string; anchor: &#123; elementIds?: string[]; point?: &#123;…&#125; &#125;; blocksIssue?: boolean; closeBy?: string; answeredBy?: &#123; elementId: string; field: string &#125;; externalRefs?: &#123; provider: string; ref: string &#125;[]; askOfAuthor?: &#123; provider: string; subject: string; displayName?: string &#125;; askedBefore?: string &#125;[]

## add_submittal

- submittalId: string
- title: string
- revision?: string
- offeredFor: &#123; elementIds?: string[]; typeIds?: string[]; requirementRefs?: string[] &#125;
- items: &#123; id: string; label: string; offeredFor?: &#123; elementIds?: string[]; typeIds?: string[]; requirementRefs?: string[] &#125;; externalRefs?: &#123; provider: string; ref: string &#125;[] &#125;[]
- externalRefs?: &#123; provider: string; ref: string &#125;[]
- lineageId?: string
- deltaDigest?: string

## answer_question

- questionId: string
- answer: string
- status?: "answered"|"assumed"
- outcome?: string
- links?: &#123; kind: string; ref: string &#125;[]
- reliesOn?: &#123; elementIds?: string[]; requirementRefs?: string[] &#125;
- at?: string

## assign_elements_to_group

- ids: string[]
- groupId: string

## attach_part_to_load_point

- loadPointId: string
- partId: string

## auto_connect_runs

- a: &#123; elementId: string; port: string &#125;
- b: &#123; elementId: string; port: string &#125;
- idPrefix: string

## calibrate_underlay

- underlayId: string
- calibration: &#123; method: "two_points"; a: &#123; x: number; y: number &#125;; b: &#123; x: number; y: number &#125;; distanceMm: number &#125; | &#123; method: "stated_scale"; scale: string; pixelsPerInch?: number &#125; | &#123; method: "cad_units"; unit: "mm"|"cm"|"m"|"in"|"ft" &#125;
- modelAt?: &#123; x: number; y: number &#125;
- rotationDeg?: number

## change_elevation

- idPrefix: string
- segmentId: string
- fromMm: number
- toMm?: number
- elevationMm: number
- style: "45"|"90"

## clear_classification

- elementIds: string[]
- system: string

## clear_group_typical

- groupId: string

## connect_into

- from: &#123; elementId: string; port: string &#125;[]
- into: string | "nearest"
- idPrefix: string

## connect_runs

- a: &#123; elementId: string; port: string &#125;
- b: &#123; elementId: string; port: string &#125;

## copy_drawing_items

- itemIds: string[]
- toOwnerId: string
- offset?: &#123; x: number; y: number &#125;
- idPrefix: string

## copy_elements

- ids: string[]
- newIds: string[]
- delta: &#123; x: number; y: number &#125;

## create_3d_view

- viewId: string
- name: string
- camera?: &#123; eye: &#123; x: number; y: number; z: number &#125;; target: &#123; x: number; y: number; z: number &#125;; up: &#123; x: number; y: number; z: number &#125;; fovDeg: number; orthoHeightMm: number &#125;
- projection?: "perspective"|"orthographic"
- cropBox?: &#123; center: &#123; x: number; y: number; z: number &#125;; halfSize: &#123; x: number; y: number; z: number &#125;; rotationDeg: number &#125;
- fit?: &#123; elementIds?: string[]; region?: &#123; min: &#123;…&#125;; max: &#123;…&#125; &#125; &#125;
- extent?: &#123; min: &#123; x: number; y: number; z: number &#125;; max: &#123; x: number; y: number; z: number &#125; &#125;
- cropView?: boolean
- showCropBox?: boolean
- workingFor?: string
- references?: object

## create_ceiling

- ceilings: &#123; ceilingId: string; levelId: string; spaceId?: string; outline: &#123; x: number; y: number &#125;[]; holes?: &#123; x: number; y: number &#125;[][]; form?: "flat"|"sloped"|"cloud"|"soffit"|"open_to_structure"; heightMm: number; reference?: &#123; x: number; y: number &#125;; slope?: &#123; directionDeg: number; pitch: number &#125;; role?: string; classId?: string; typeId?: string &#125;[]

## create_element

- elementId: string
- levelId: string
- placement: &#123; kind: "point"; position: &#123; x: number; y: number &#125;; rotationDeg?: number &#125; | &#123; kind: "line"; start: &#123; x: number; y: number &#125;; end: &#123; x: number; y: number &#125; &#125; | &#123; kind: "area"; outline: &#123; x: number; y: number &#125;[]; holes?: &#123; x: number; y: number &#125;[][] &#125;
- kind: string
- typeId?: string
- values?: object
- size?: &#123; thicknessMm?: number; heightMm?: number; widthMm?: number; depthMm?: number &#125;
- label?: string
- topLevelId?: string
- topOffsetMm?: number
- topSurface?: &#123; to: "structure"|"ceiling"|"roof"|"floor"; elementId?: string; face?: "top"|"underside"; offsetMm?: number &#125;
- baseSurface?: &#123; to: "structure"|"ceiling"|"roof"|"floor"; elementId?: string; face?: "top"|"underside"; offsetMm?: number &#125;
- baseOffsetMm?: number

## create_element_type

- typeId: string
- name: string
- classId?: string
- forKinds?: "wall"|"slab"|"opening"|"room"|"grid"|"column"|"beam"|"component"|"ceiling"[]
- values?: object

## create_elements

- idPrefix: string
- levelId: string
- points: &#123; x: number; y: number &#125;[]
- closed?: boolean
- kind: string
- typeId?: string
- values?: object
- size?: &#123; thicknessMm?: number; heightMm?: number; widthMm?: number; depthMm?: number &#125;
- label?: string
- topLevelId?: string
- topOffsetMm?: number
- topSurface?: &#123; to: "structure"|"ceiling"|"roof"|"floor"; elementId?: string; face?: "top"|"underside"; offsetMm?: number &#125;
- baseSurface?: &#123; to: "structure"|"ceiling"|"roof"|"floor"; elementId?: string; face?: "top"|"underside"; offsetMm?: number &#125;
- baseOffsetMm?: number

## create_group

- groupId: string
- name: string
- color?: string
- description?: string
- defaultVisibility?: "show"|"halftone"|"hide"

## create_hosted

- elementId: string
- kind: string
- hostId: string
- s: number
- side: 1 | -1
- typeId?: string
- openingType?: string
- mark?: string
- values?: object
- size?: &#123; thicknessMm?: number; heightMm?: number; widthMm?: number; depthMm?: number &#125;

## create_level

- levelId: string
- name: string
- elevationMm: number

## create_load

- loads: &#123; id: string; anchor?: &#123; kind: "none" &#125; | &#123; kind: "space"; id: string &#125; | &#123; kind: "zone"; id: string &#125; | &#123; kind: "run_end"; hostId: string; port: string &#125; | &#123; kind: "point"; levelId: string; position: &#123;…&#125; &#125; | &#123; kind: "part"; partId: string; connector?: string &#125;; connectionType?: string; values?: &#123; wsfu_cold?: number; wsfu_hot?: number; wsfu_total?: number; dfu?: number; gpm_fixed?: number; gph_demand?: number; mbh?: number; min_inlet_pressure?: number; cfm?: number; va?: number; sizes?: &#123;…&#125;; custom?: &#123;…&#125;[] &#125;; mark?: string; schematic?: boolean; note?: string; service?: "power"|"cold_water"|"hot_water"|"sanitary"|"grease_waste"|"gas"|"supply_air"|"outside_air"|"exhaust_air"|"heat_gain"; basis?: "lump"|"density"|"count"|"calc"; rates?: &#123; key: "wsfu_cold"|"wsfu_hot"|"wsfu_total"|"dfu"|"gpm_fixed"|"gph_demand"|"mbh"|"min_inlet_pressure"|"cfm"|"va"; per: "area"|"occupant"; value: number &#125;[]; count?: number; servedBy?: string; source?: &#123; kind: "code"|"calc"|"engineer"|"client"|"vendor_doc"; ref: string &#125;; future?: boolean &#125;[]

## create_load_point

- points: &#123; hostId: string; port: string; connectionType?: string; values?: &#123; wsfu_cold?: number; wsfu_hot?: number; wsfu_total?: number; dfu?: number; gpm_fixed?: number; gph_demand?: number; mbh?: number; min_inlet_pressure?: number; cfm?: number; va?: number; sizes?: &#123;…&#125;; custom?: &#123;…&#125;[] &#125;; mark?: string; schematic?: boolean; note?: string &#125;[]

## create_mounting_plane

- planeId: string
- levelId: string
- name: string
- heightMm: number
- corner1: &#123; x: number; y: number &#125;
- corner2: &#123; x: number; y: number &#125;

## create_phase

- phaseId: string
- name: string
- after?: string | null

## create_phase_filter

- filterId: string
- name: string
- statuses: &#123; new: "show"|"halftone"|"dashed"|"hide"; existing: "show"|"halftone"|"dashed"|"hide"; demolished: "show"|"halftone"|"dashed"|"hide"; temporary: "show"|"halftone"|"dashed"|"hide" &#125;

## create_service_link

- linkId: string
- sourceId: string
- positions?: number[]
- members: &#123; elementId: string; connector?: string &#125;[]
- description?: string
- electrical?: &#123; ratingA?: number; frameA?: number; loadClass?: string; conductors?: &#123; sets: number; phaseSize: string; neutralSize?: string; groundSize?: string; material: "cu"|"al" &#125;; lengthFt?: number; feederType?: string &#125;

## create_sheet

- sheetId: string
- number: string
- name: string
- titleBlock?: "arch_d_mutinybim"|"ansi_b_mutinybim"
- titleBlockRow?: &#123; id: string; revision: number; name: string; definition: &#123; schema: 1; paperName: string; paperMm: &#123;…&#125;; marginsMm: &#123;…&#125;; stripWidthMm: number; colors: &#123;…&#125;; fonts: &#123;…&#125;; lines: &#123;…&#125;; slots: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[] &#125; &#125;
- fields?: object
- revisions?: &#123; number: string; date: string; description: string &#125;[]

## create_space

- spaces: &#123; spaceId: string; number: string; name: string; levelId?: string; outline?: &#123; x: number; y: number &#125;[]; origin?: &#123; kind: "drawn" &#125; | &#123; kind: "traced"; underlayId: string &#125; | &#123; kind: "from_linked_room"; linkId: string; roomRef: string &#125; | &#123; kind: "detected"; detector: string; confidence: number; underlayId?: string; accepted?: true &#125;; use?: &#123; libraryId: string; useId: string; name: string; revision?: number; occupantsPerM2?: number; rates?: &#123;…&#125;[]; parameterRates?: &#123;…&#125;[] &#125;; occupants?: number; ceilingHeightMm?: number; slabToSlabMm?: number; block?: boolean; note?: string &#125;[]

## create_tag_style

- styleId: string
- name: string
- lines: string[]
- textSizeMm?: number
- leader?: boolean
- box?: "box"|"none"|"rounded"|"circle"|"hexagon"|"diamond"
- defaultFor?: "duct"|"pipe"|"air_terminal"|"equipment"|"fixture"|"part"|"room"|"space"[]
- prefix?: string
- suffix?: string
- orientation?: "horizontal"|"along"
- units?: "ft_in"|"ft"|"in"|"mm"|"m"
- leaderEnd?: "dot"|"arrow"|"tick"|"none"
- appliesTo?: "duct"|"pipe"|"air_terminal"|"equipment"|"fixture"|"part"|"room"|"space"[]
- arrow?: "none"|"down_slope"|"up_slope"
- mask?: boolean
- textStyleId?: string

## create_text_note

- itemId: string
- ownerId: string
- at: &#123; x: number; y: number &#125;
- width: number
- height?: number | null
- rotation?: number
- textSize?: number
- lineSpacing?: number
- paragraphs: &#123; runs: &#123; text: string; bold?: boolean; italic?: boolean; underline?: boolean; size?: number; font?: "sans"; color?: string &#125;[]; align?: "left"|"center"|"right"|"justify"; list?: &#123; kind: "bullet"|"numbered"; level: number; start?: number &#125; &#125;[]
- leader?: &#123; x: number; y: number &#125; | null
- leaders?: &#123; to: &#123; x: number; y: number &#125;; elbow?: &#123; x: number; y: number &#125;; arrow?: "arrow"|"dot"|"tick"|"none" &#125;[]

## create_text_style

- styleId: string
- name: string
- textSizeMm?: number
- fontFamily?: string
- bold?: boolean
- italic?: boolean
- uppercase?: boolean
- background?: "transparent"|"opaque"
- color?: string
- defaultFor?: "part_mark"|"link_label"|"tag"|"dimension"|"note"|"space_label"[]

## create_view

- viewId: string
- name: string
- viewType: "floor_plan"|"ceiling_plan"|"section"|"elevation"|"three_d"|"detail"|"schedule"
- crop?: &#123; min: &#123; x: number; y: number &#125;; max: &#123; x: number; y: number &#125; &#125;
- props?: &#123; level?: string; levelElevationMm?: number; scale?: number; cutHeightMm?: number; viewDepthMm?: number; viewBottomMm?: number | null; viewTopMm?: number | null; discipline?: string|null; hiddenCategories?: "duct"|"duct_fitting"|"pipe"|"air_terminal"|"equipment"|"walls"|"doors_windows"|"rooms"|"grids"|"structure"|"tags"|"dimensions"|"electrical_devices"|"lighting_fixtures"|"electrical_equipment"|"insulation"[]; hiddenDraftingCategories?: "detail_lines"|"hatching"|"masking"|"components"|"insulation"|"text"|"dimensions"|"tags"|"clouds"[]; references?: object; linkedHiddenLines?: boolean; linkedMinObjectMm?: number; detailLevel?: "coarse"|"medium"|"fine"; showLineCodes?: boolean; symbolScale?: number; visualStyle?: "wireframe"|"hidden_line"|"shaded"|"shaded_edges"; showHiddenLines?: boolean; hiddenLineCategories?: "duct"|"duct_fitting"|"pipe"|"air_terminal"|"equipment"|"walls"|"doors_windows"|"rooms"|"grids"|"structure"|"tags"|"dimensions"|"electrical_devices"|"lighting_fixtures"|"electrical_equipment"|"insulation"[]; lineWeights?: object; categoryOverrides?: object; cutPattern?: "cross"|"solid"|"hatch"; section?: &#123; start: &#123;…&#125;; end: &#123;…&#125;; direction: 1 | -1; depthMm: number; headExtMm?: number; tailExtMm?: number; splitGap?: boolean &#125;; cropView?: boolean; showCropBox?: boolean; annotationCrop?: boolean; annotationCropOffsetMm?: number; levelLeftExtMm?: number; levelRightExtMm?: number; phaseId?: string; phaseFilterId?: string; groupDisplay?: object; orientation?: "plan_north"|"true_north"|"working_angle"; workingAngleDeg?: number | null; projection?: "perspective"|"orthographic"; schedule?: &#123; category: "mechanical_equipment"|"air_terminal"|"duct_accessory"|"pipe_accessory"|"plumbing_fixture"|"electrical_equipment"|"electrical_device"|"lighting_fixture"|"generic"|"sheet_list"|"duct"|"pipe"; title?: string; columns: &#123;…&#125;[]; sort?: &#123;…&#125;[]; filters?: &#123;…&#125;[]; level?: string; itemize?: boolean; textSizeMm?: number; emptyText?: string &#125;; formSchedule?: &#123; kind: string; elementId?: string; template: &#123;…&#125;; rules?: string; textSizeMm?: number; emptyText?: string; templateSource?: &#123;…&#125; &#125;; scheduleV2?: &#123; name: string; source: &#123;…&#125; | &#123;…&#125; | &#123;…&#125;; columns: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; filters: &#123;…&#125;[]; sort: &#123;…&#125;[]; groups: &#123;…&#125;[]; grandTotals: boolean; itemize: boolean; presentation: &#123;…&#125; | &#123;…&#125;; display: &#123;…&#125;; pins?: &#123;…&#125;[] &#125;; diagram?: &#123; kind: string; hints?: &#123;…&#125; &#125; &#125;

## create_zone

- zoneId: string
- name: string
- purpose: "thermal"|"ventilation"|"electrical_load_region"|"fire_area"|"smoke"|"lighting_control"|"sprinkler_hazard"|"structural_load_area"|"drainage_catchment"|"code_clearance" | string | string
- spaceIds?: string[]
- outline?: &#123; levelId: string; outline: &#123; x: number; y: number &#125;[]; topMm?: number; bottomMm?: number &#125;
- servedBy?: string

## decline_question

- questionId: string
- note?: string
- not_in_scope?: boolean
- keep_closed?: string
- at?: string

## delete_catalog_entry

- entryType: string
- name: string

## delete_ceilings

- ceilingIds: string[]

## delete_construction_stage

- stageId: string

## delete_drawing_item

- itemId: string

## delete_elements

- ids: string[]
- policy: "refuse"|"disconnect"|"cascade"

## delete_group

- groupId: string
- moveTo?: string

## delete_load_points

- loadPointIds: string[]

## delete_local_rules

- ruleIds: string[]

## delete_phase

- phaseId: string

## delete_phase_filter

- filterId: string

## delete_questions

- questionIds: string[]

## delete_sheet

- sheetId: string

## delete_spaces

- spaceIds: string[]

## delete_stacks

- stackIds: string[]

## delete_tag_style

- styleId: string

## delete_text_note

- itemId: string

## delete_text_style

- styleId: string

## delete_underlays

- underlayIds: string[]

## delete_view

- viewId: string
- placed?: "refuse"|"remove_from_sheet"

## delete_zones

- zoneIds: string[]

## demolish_elements

- ids: string[]
- phaseId?: string

## detach_part_from_load_point

- loadPointId: string

## disconnect_run

- elementId: string
- port: string

## drag_run

- elementId: string
- delta: &#123; x: number; y: number; z: number &#125;
- grip?: "start"|"end"
- reroute?: boolean

## duplicate_view

- viewId: string
- newViewId: string
- name?: string

## edit_ceiling

- ceilingId: string
- levelId?: string
- spaceId?: string | null
- outline?: &#123; x: number; y: number &#125;[]
- holes?: &#123; x: number; y: number &#125;[][] | null
- form?: "flat"|"sloped"|"cloud"|"soffit"|"open_to_structure"
- heightMm?: number
- reference?: &#123; x: number; y: number &#125; | null
- slope?: &#123; directionDeg: number; pitch: number &#125; | null
- role?: string | null
- classId?: string
- typeId?: string | null

## edit_construction_stage

- stageId: string
- name?: string
- zoneIds?: string[]
- classIds?: string[]
- plannedStart?: string | null
- plannedFinish?: string | null

## edit_field_block

- itemId: string
- template?: string
- title?: string | null
- subjectId?: string | null
- table?: &#123; kind: "ventilation"|"pressurization"|"gas"; scope: &#123; kind: "model" &#125; | &#123; kind: "level"; levelId: string &#125; | &#123; kind: "zone"; zoneId: string &#125; &#125; | &#123; kind: "keynotes"; sheetId: string; table: &#123; id: string; revision: number; name: string; keynotes: &#123;…&#125;[] &#125; &#125; | null
- calc?: &#123; template: string; options?: object &#125; | null

## edit_load_point

- loadId?: string
- loadPointId?: string
- partId?: string
- connectionType?: string
- values?: &#123; wsfu_cold?: number; wsfu_hot?: number; wsfu_total?: number; dfu?: number; gpm_fixed?: number; gph_demand?: number; mbh?: number; min_inlet_pressure?: number; cfm?: number; va?: number; sizes?: &#123; cw?: string; hw?: string; w?: string; v?: string; g?: string &#125;; custom?: &#123; name: string; unit: string; value: number; add?: "sum"|"max"|"none" &#125;[] &#125;
- reset?: "wsfu_cold"|"wsfu_hot"|"wsfu_total"|"dfu"|"gpm_fixed"|"gph_demand"|"mbh"|"min_inlet_pressure"|"cfm"|"va"[]
- mark?: string
- schematic?: boolean
- note?: string
- service?: "power"|"cold_water"|"hot_water"|"sanitary"|"grease_waste"|"gas"|"supply_air"|"outside_air"|"exhaust_air"|"heat_gain"
- basis?: "lump"|"density"|"count"|"calc"
- rates?: &#123; key: "wsfu_cold"|"wsfu_hot"|"wsfu_total"|"dfu"|"gpm_fixed"|"gph_demand"|"mbh"|"min_inlet_pressure"|"cfm"|"va"; per: "area"|"occupant"; value: number &#125;[]
- count?: number
- servedBy?: string
- source?: &#123; kind: "code"|"calc"|"engineer"|"client"|"vendor_doc"; ref: string &#125;
- future?: boolean
- clearServedBy?: boolean

## edit_local_rule

- ruleId: string
- rule: object

## edit_question

- questionId: string
- questionType?: "question"|"assumption"|"field_verify"
- number?: string
- text?: string
- askOf?: string
- anchor?: &#123; elementIds?: string[]; point?: &#123; levelId: string; position: &#123;…&#125; &#125; &#125;
- blocksIssue?: boolean
- closeBy?: string | null
- answeredBy?: &#123; elementId: string; field: string &#125; | null
- externalRefs?: &#123; provider: string; ref: string &#125;[]

## edit_schedule

- viewId: string
- steps: &#123; op: "add_column"; column: &#123; id: string; heading?: string; unit?: unknown; precision?: &#123;…&#125; | &#123;…&#125;; total?: boolean; hideWhenEmpty?: boolean; width?: number; widthMm?: number; highlights?: &#123;…&#125;[]; kind: "field"; path: string &#125; | &#123; id: string; heading?: string; unit?: unknown; precision?: &#123;…&#125; | &#123;…&#125;; total?: boolean; hideWhenEmpty?: boolean; width?: number; widthMm?: number; highlights?: &#123;…&#125;[]; kind: "parameter"; path: string &#125; | &#123; id: string; heading?: string; unit?: unknown; precision?: &#123;…&#125; | &#123;…&#125;; total?: boolean; hideWhenEmpty?: boolean; width?: number; widthMm?: number; highlights?: &#123;…&#125;[]; kind: "formula"; expression: string; calculation?: string &#125; | &#123; id: string; heading?: string; unit?: unknown; precision?: &#123;…&#125; | &#123;…&#125;; total?: boolean; hideWhenEmpty?: boolean; width?: number; widthMm?: number; highlights?: &#123;…&#125;[]; kind: "aggregate"; fn: "sum"|"count"|"min"|"max"|"avg"|"list"; relationship: string; path?: string &#125; | &#123; id: string; heading?: string; unit?: unknown; precision?: &#123;…&#125; | &#123;…&#125;; total?: boolean; hideWhenEmpty?: boolean; width?: number; widthMm?: number; highlights?: &#123;…&#125;[]; kind: "expand"; relationship: string; columns: string[]; paper: "nested"|"summary"|"hidden" &#125;; at?: number &#125; | &#123; op: "move_column"; columnId: string; to: number &#125; | &#123; op: "remove_column"; columnId: string &#125; | &#123; op: "rename_column"; columnId: string; heading: string | null &#125; | &#123; op: "filter"; filters: &#123; path: string; op: "equals"|"not_equals"|"contains"|"greater_than"|"less_than"|"present"|"absent"; value?: string &#125;[] &#125; | &#123; op: "sort"; sort: &#123; path: string; direction: "asc"|"desc" &#125;[] &#125; | &#123; op: "group"; groups: &#123; path: string; header: boolean; footer: boolean; totals: boolean &#125;[] &#125; | &#123; op: "totals"; columnId?: string; show: boolean &#125; | &#123; op: "resize_column"; columnId: string; widthMm: number | null &#125;[]

## edit_service_link

- linkId: string
- sourceId?: string
- positions?: number[]
- description?: string
- electrical?: &#123; ratingA?: number | null; frameA?: number | null; loadClass?: string | null; conductors?: &#123; sets: number; phaseSize: string; neutralSize?: string; groundSize?: string; material: "cu"|"al" &#125; | null; lengthFt?: number | null; feederType?: string | null &#125;

## edit_space

- spaceId: string
- number?: string
- name?: string
- levelId?: string
- outline?: &#123; x: number; y: number &#125;[]
- tracedOver?: string
- use?: &#123; libraryId: string; useId: string; name: string; revision?: number; occupantsPerM2?: number; rates?: &#123; key: "wsfu_cold"|"wsfu_hot"|"wsfu_total"|"dfu"|"gpm_fixed"|"gph_demand"|"mbh"|"min_inlet_pressure"|"cfm"|"va"; per: "area"|"occupant"; value: number &#125;[]; parameterRates?: &#123; key: string; per: "area"|"occupant"; value: number &#125;[] &#125; | null
- occupants?: number | null
- ceilingHeightMm?: number | null
- slabToSlabMm?: number | null
- block?: boolean|null
- note?: string | null
- estimateCounting?: "max"|"actual_only"|"allocation_only" | null
- accept?: true

## edit_stack

- stackId: string
- number?: string
- name?: string | null
- systemCode?: string | null
- serves?: string | null
- pipeId?: string

## edit_text_note

- itemId: string
- expectedContent: string
- paragraphs: &#123; runs: &#123; text: string; bold?: boolean; italic?: boolean; underline?: boolean; size?: number; font?: "sans"; color?: string &#125;[]; align?: "left"|"center"|"right"|"justify"; list?: &#123; kind: "bullet"|"numbered"; level: number; start?: number &#125; &#125;[]
- textSize?: number
- lineSpacing?: number

## edit_underlay

- underlayId: string
- opacityPct?: number
- locked?: boolean
- hidden?: boolean
- modelAt?: &#123; x: number; y: number &#125;
- rotationDeg?: number

## edit_zone

- zoneId: string
- name?: string
- purpose?: "thermal"|"ventilation"|"electrical_load_region"|"fire_area"|"smoke"|"lighting_control"|"sprinkler_hazard"|"structural_load_area"|"drainage_catchment"|"code_clearance" | string | string
- addSpaceIds?: string[]
- removeSpaceIds?: string[]
- servedBy?: string | null

## elbow_to_tee

- fittingId: string
- through: string
- idPrefix: string
- face?: "top"|"bottom"

## ensure_starter_level

## forward_question

- questionId: string
- askOf: string
- askOfAuthor?: &#123; provider: string; subject: string; displayName?: string &#125;
- note?: string
- at?: string

## freeze_stage

- gateId: string
- stageId: string
- lineageId?: string
- purpose?: string
- label?: string
- issuedSetRefs?: string[]
- signoffSeqs?: number[]
- dispositionIds?: string[]
- frozenBy: &#123; provider: string; subject: string; kind: string; displayName?: string; keyId?: string &#125;
- frozenAt: string
- stateDigest?: string
- loads?: &#123; lines: &#123; key: string; unit: string; total: number; byBasis?: object &#125;[] &#125;
- openFindings?: &#123; id: string; severity: string; sourceKind?: string &#125;[]

## insert_library_view

- viewId: string
- idPrefix: string
- name?: string
- item: &#123; itemId: string; revision: number; contentHash: string; body: object &#125;

## join_parts

- a: &#123; elementId: string; port: string &#125;
- b: &#123; elementId: string; port: string &#125;

## lock_elements

- elementIds: string[]
- state: "existing"|"issued"
- reason: string

## lock_group

- groupId: string
- locked: boolean

## make_ceiling_from_space_height

- spaceId: string
- ceilingId?: string

## make_spaces_from_rooms

- roomIds?: string[]
- levelId?: string
- use?: &#123; libraryId: string; useId: string; name: string; revision?: number; occupantsPerM2?: number; rates?: &#123; key: "wsfu_cold"|"wsfu_hot"|"wsfu_total"|"dfu"|"gpm_fixed"|"gph_demand"|"mbh"|"min_inlet_pressure"|"cfm"|"va"; per: "area"|"occupant"; value: number &#125;[]; parameterRates?: &#123; key: string; per: "area"|"occupant"; value: number &#125;[] &#125;

## merge_space_children

- spaceId: string

## move_elements

- ids: string[]
- delta: &#123; x: number; y: number &#125;
- dzMm?: number
- disjoin?: boolean

## move_equipment

- equipmentId: string
- delta: &#123; x: number; y: number &#125;

## move_line_end

- elementId: string
- end: "start"|"end"
- to: &#123; x: number; y: number &#125;
- disjoin?: boolean

## move_load

- loadId?: string
- loadPointId?: string
- to: &#123; kind: "none" &#125; | &#123; kind: "space"; id: string &#125; | &#123; kind: "zone"; id: string &#125; | &#123; kind: "run_end"; hostId: string; port: string &#125; | &#123; kind: "point"; levelId: string; position: &#123; x: number; y: number &#125; &#125; | &#123; kind: "part"; partId: string; connector?: string &#125;

## move_tag

- tagId: string
- offset: &#123; x: number; y: number &#125;

## move_text_note

- itemId: string
- at?: &#123; x: number; y: number &#125;
- rotation?: number
- leader?: &#123; x: number; y: number &#125; | null
- leaders?: &#123; to: &#123; x: number; y: number &#125;; elbow?: &#123; x: number; y: number &#125;; arrow?: "arrow"|"dot"|"tick"|"none" &#125;[]

## move_viewport

- viewportId: string
- center: &#123; x: number; y: number &#125;

## move_wall

- wallId: string
- delta: &#123; x: number; y: number &#125;
- disjoin?: boolean

## name_stacks

- stacks: &#123; stackId: string; pipeId: string; number?: string; name?: string; systemCode?: string; serves?: string &#125;[]

## offset_run

- idPrefix: string
- segmentId: string
- atMm: number
- offset: &#123; x: number; y: number; z: number &#125;
- lengthMm?: number
- style: "45"|"90"|"ogee"

## pin_firm_discipline

- discipline: &#123; id: string; label: string; parent?: string; group?: &#123; id: string; label: string &#125;; display: &#123; colour: string; icon?: string &#125;; defaultResponsibleRole?: string; ifc?: &#123; systemType?: string; name?: string &#125; &#125;

## place_devices

- label: string
- levelId: string
- partTypes?: &#123; typeId: string; definition: &#123; familyName: string; typeName: string; category: "mechanical_equipment"|"air_terminal"|"duct_accessory"|"pipe_accessory"|"plumbing_fixture"|"electrical_equipment"|"electrical_device"|"lighting_fixture"|"generic"; description?: string; hosting?: "free"|"wall_face"|"ceiling"|"floor"; typeParams: &#123;…&#125;[]; typeValues: object; instanceParams: &#123;…&#125;[]; connectors: &#123;…&#125;[]; geometry: &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; symbol: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; tagFields: string[]; source: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;; model?: &#123;…&#125; | &#123;…&#125;; clearances?: &#123;…&#125;[]; positions?: &#123;…&#125;[] &#125; &#125;[]
- devices: &#123; partId: string; typeId: string; position: &#123; x: number; y: number &#125;; rotationDeg?: number; offsetMm?: number; zone?: string; mark?: string; values?: object &#125;[]

## place_part

- partId: string
- typeId: string
- partType?: &#123; familyName: string; typeName: string; category: "mechanical_equipment"|"air_terminal"|"duct_accessory"|"pipe_accessory"|"plumbing_fixture"|"electrical_equipment"|"electrical_device"|"lighting_fixture"|"generic"; description?: string; hosting?: "free"|"wall_face"|"ceiling"|"floor"; typeParams: &#123; name: string; label: string; kind: "number"|"length"|"angle"|"text"|"boolean"|"choice"|"material"; unit?: string; min?: number; max?: number; choices?: string[]; required?: boolean; default?: number | string | boolean; formula?: string &#125;[]; typeValues: object; instanceParams: &#123; name: string; label: string; kind: "number"|"length"|"angle"|"text"|"boolean"|"choice"|"material"; unit?: string; min?: number; max?: number; choices?: string[]; required?: boolean; default?: number | string | boolean; formula?: string &#125;[]; connectors: &#123; id: string; label: string; domain: unknown; systemKind: unknown; position: unknown[]; direction: unknown[]; shape: "rect"|"round"|"none"; width?: number | &#123;…&#125; | &#123;…&#125;; height?: number | &#123;…&#125; | &#123;…&#125;; diameter?: number | &#123;…&#125; | &#123;…&#125;; flow?: number | &#123;…&#125; | &#123;…&#125;; voltage?: number | &#123;…&#125; | &#123;…&#125;; poles?: number; loadClass?: string; continuous?: boolean; motorHp?: number | &#123;…&#125; | &#123;…&#125;; flowDirection?: "in"|"out"|"bidirectional"; widthAxis?: unknown[]; intake?: "hood"|"louver"|"screen"; values?: object; endType?: unknown &#125;[]; geometry: &#123; kind: "box"; center: unknown[]; size: unknown[] &#125; | &#123; kind: "cylinder"; center: unknown[]; radius: number | &#123;…&#125; | &#123;…&#125;; height: number | &#123;…&#125; | &#123;…&#125;; axis: "x"|"y"|"z" &#125; | &#123; kind: "extrusion"; profile: unknown[][]; z: number | &#123;…&#125; | &#123;…&#125;; height: number | &#123;…&#125; | &#123;…&#125; &#125;[]; symbol: &#123; kind: "rect"; center: unknown[]; size: unknown[]; fill?: "solid"|"mask"; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "circle"; center: unknown[]; radius: number | &#123;…&#125; | &#123;…&#125;; fill?: "solid"|"mask"; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "arc"; center: unknown[]; radius: number | &#123;…&#125; | &#123;…&#125;; startDeg: number; sweepDeg: number; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "line"; from: unknown[]; to: unknown[]; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "polyline"; points: unknown[][]; closed: boolean; fill?: "solid"|"mask"; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "text"; at: unknown[]; text: string; heightMm: number; anchor?: "start"|"middle"|"end"; uprightOffset?: unknown[]; mask?: boolean; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125;[]; tagFields: string[]; source: &#123; kind: "builtin"; libraryVersion: string &#125; | &#123; kind: "revit"; familyName: string; typeName: string; revitCategory: string; origin?: string; boundingBoxGeometry: boolean &#125; | &#123; kind: "cut_sheet"; fileName: string; fileId?: string &#125; | &#123; kind: "script"; key?: string; version?: string &#125; | &#123; kind: "ifc"; entity: string; typeName: string; boundingBoxGeometry: true &#125;; model?: &#123; schema: 2; id: string; referencePlanes: &#123;…&#125;[]; sketches: &#123;…&#125;[]; profiles: &#123;…&#125;[]; features: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; symbols: &#123;…&#125;[]; planDisplay: "model"|"symbol"|"both"; types: &#123;…&#125;[] &#125; | &#123; id: string; referencePlanes: &#123;…&#125;[]; sketches: &#123;…&#125;[]; features: &#123;…&#125; | &#123;…&#125;[]; planDisplay: "model"|"symbol"|"both"; types: &#123;…&#125;[] &#125;; clearances?: &#123; id: string; name: string; purpose: string; face: "front"|"back"|"left"|"right"|"top"|"bottom"; depth: number | &#123;…&#125; | &#123;…&#125;; width?: number | &#123;…&#125; | &#123;…&#125;; height?: number | &#123;…&#125; | &#123;…&#125;; offset?: number | &#123;…&#125; | &#123;…&#125;; fromFloor?: boolean; basis?: &#123;…&#125;; excludes?: "solid"|"foreign_systems"; toStructure?: boolean; endsAtSuspendedCeiling?: boolean; cite?: string &#125;[]; positions?: &#123; id: string; name: string; role: string; envelopes: &#123;…&#125;[] &#125;[] &#125;
- levelId: string
- discipline?: string
- zone?: string
- position: &#123; x: number; y: number &#125;
- offsetMm?: number
- rotationDeg?: number
- mark?: string
- values?: object
- host?: &#123; kind: "slab"; elementId: string &#125; | &#123; kind: "linked"; referenceId: string; globalId?: string; localId?: number; name: string; surface?: "slab"|"roof"; topMm: number &#125; | &#123; kind: "element"; elementId: string; stationMm: number &#125; | &#123; kind: "wall_face"; elementId: string; stationMm: number; side: 1 | -1; faceOffsetMm?: number &#125;
- curbMm?: number
- mount?: "turned_over"|"on_side"
- intakes?: object
- planeId?: string

## place_planned_part

- partId: string
- levelId: string
- position: &#123; x: number; y: number &#125;
- offsetMm?: number
- rotationDeg?: number
- zone?: string
- host?: &#123; kind: "slab"; elementId: string &#125; | &#123; kind: "linked"; referenceId: string; globalId?: string; localId?: number; name: string; surface?: "slab"|"roof"; topMm: number &#125; | &#123; kind: "element"; elementId: string; stationMm: number &#125; | &#123; kind: "wall_face"; elementId: string; stationMm: number; side: 1 | -1; faceOffsetMm?: number &#125;
- curbMm?: number
- planeId?: string

## place_run_accessory

- accessoryId: string
- segmentId: string
- atMm: number
- family: string
- params?: object

## place_service_layout

- label: string
- levelId: string
- planOnly?: true
- partTypes: &#123; typeId: string; definition: &#123; familyName: string; typeName: string; category: "mechanical_equipment"|"air_terminal"|"duct_accessory"|"pipe_accessory"|"plumbing_fixture"|"electrical_equipment"|"electrical_device"|"lighting_fixture"|"generic"; description?: string; hosting?: "free"|"wall_face"|"ceiling"|"floor"; typeParams: &#123;…&#125;[]; typeValues: object; instanceParams: &#123;…&#125;[]; connectors: &#123;…&#125;[]; geometry: &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; symbol: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; tagFields: string[]; source: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;; model?: &#123;…&#125; | &#123;…&#125;; clearances?: &#123;…&#125;[]; positions?: &#123;…&#125;[] &#125; &#125;[]
- equipment: &#123; partId: string; typeId: string; position: &#123; x: number; y: number &#125;; values: object &#125;[]
- feeders: &#123; linkId: string; sourceId: string; fedId: string; ratingA?: number &#125;[]

## place_space_in_walls

- spaceId: string
- levelId: string
- seed: &#123; x: number; y: number &#125;
- number?: string
- name?: string
- use?: &#123; libraryId: string; useId: string; name: string; revision?: number; occupantsPerM2?: number; rates?: &#123; key: "wsfu_cold"|"wsfu_hot"|"wsfu_total"|"dfu"|"gpm_fixed"|"gph_demand"|"mbh"|"min_inlet_pressure"|"cfm"|"va"; per: "area"|"occupant"; value: number &#125;[]; parameterRates?: &#123; key: string; per: "area"|"occupant"; value: number &#125;[] &#125;

## place_underlay

- underlayId: string
- levelId: string
- source: &#123; format: "pdf"|"image"|"dxf"|"dwg"; provider: string; ref: string; page?: number; name: string &#125;
- opacityPct?: number

## place_viewport

- viewportId: string
- sheetId: string
- viewId: string
- center: &#123; x: number; y: number &#125;
- scale?: number
- titleOffsetMm?: &#123; x: number; y: number &#125;
- titleRuleMm?: number

## plan_part

- partId: string
- typeId: string
- partType?: &#123; familyName: string; typeName: string; category: "mechanical_equipment"|"air_terminal"|"duct_accessory"|"pipe_accessory"|"plumbing_fixture"|"electrical_equipment"|"electrical_device"|"lighting_fixture"|"generic"; description?: string; hosting?: "free"|"wall_face"|"ceiling"|"floor"; typeParams: &#123; name: string; label: string; kind: "number"|"length"|"angle"|"text"|"boolean"|"choice"|"material"; unit?: string; min?: number; max?: number; choices?: string[]; required?: boolean; default?: number | string | boolean; formula?: string &#125;[]; typeValues: object; instanceParams: &#123; name: string; label: string; kind: "number"|"length"|"angle"|"text"|"boolean"|"choice"|"material"; unit?: string; min?: number; max?: number; choices?: string[]; required?: boolean; default?: number | string | boolean; formula?: string &#125;[]; connectors: &#123; id: string; label: string; domain: unknown; systemKind: unknown; position: unknown[]; direction: unknown[]; shape: "rect"|"round"|"none"; width?: number | &#123;…&#125; | &#123;…&#125;; height?: number | &#123;…&#125; | &#123;…&#125;; diameter?: number | &#123;…&#125; | &#123;…&#125;; flow?: number | &#123;…&#125; | &#123;…&#125;; voltage?: number | &#123;…&#125; | &#123;…&#125;; poles?: number; loadClass?: string; continuous?: boolean; motorHp?: number | &#123;…&#125; | &#123;…&#125;; flowDirection?: "in"|"out"|"bidirectional"; widthAxis?: unknown[]; intake?: "hood"|"louver"|"screen"; values?: object; endType?: unknown &#125;[]; geometry: &#123; kind: "box"; center: unknown[]; size: unknown[] &#125; | &#123; kind: "cylinder"; center: unknown[]; radius: number | &#123;…&#125; | &#123;…&#125;; height: number | &#123;…&#125; | &#123;…&#125;; axis: "x"|"y"|"z" &#125; | &#123; kind: "extrusion"; profile: unknown[][]; z: number | &#123;…&#125; | &#123;…&#125;; height: number | &#123;…&#125; | &#123;…&#125; &#125;[]; symbol: &#123; kind: "rect"; center: unknown[]; size: unknown[]; fill?: "solid"|"mask"; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "circle"; center: unknown[]; radius: number | &#123;…&#125; | &#123;…&#125;; fill?: "solid"|"mask"; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "arc"; center: unknown[]; radius: number | &#123;…&#125; | &#123;…&#125;; startDeg: number; sweepDeg: number; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "line"; from: unknown[]; to: unknown[]; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "polyline"; points: unknown[][]; closed: boolean; fill?: "solid"|"mask"; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125; | &#123; kind: "text"; at: unknown[]; text: string; heightMm: number; anchor?: "start"|"middle"|"end"; uprightOffset?: unknown[]; mask?: boolean; units?: "model"|"paper"; minPaperMm?: number; pen?: "thin"|"medium"|"wide"|"heavy"; detailLevels?: "coarse"|"medium"|"fine"[]; upright?: boolean; when?: &#123;…&#125; &#125;[]; tagFields: string[]; source: &#123; kind: "builtin"; libraryVersion: string &#125; | &#123; kind: "revit"; familyName: string; typeName: string; revitCategory: string; origin?: string; boundingBoxGeometry: boolean &#125; | &#123; kind: "cut_sheet"; fileName: string; fileId?: string &#125; | &#123; kind: "script"; key?: string; version?: string &#125; | &#123; kind: "ifc"; entity: string; typeName: string; boundingBoxGeometry: true &#125;; model?: &#123; schema: 2; id: string; referencePlanes: &#123;…&#125;[]; sketches: &#123;…&#125;[]; profiles: &#123;…&#125;[]; features: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; symbols: &#123;…&#125;[]; planDisplay: "model"|"symbol"|"both"; types: &#123;…&#125;[] &#125; | &#123; id: string; referencePlanes: &#123;…&#125;[]; sketches: &#123;…&#125;[]; features: &#123;…&#125; | &#123;…&#125;[]; planDisplay: "model"|"symbol"|"both"; types: &#123;…&#125;[] &#125;; clearances?: &#123; id: string; name: string; purpose: string; face: "front"|"back"|"left"|"right"|"top"|"bottom"; depth: number | &#123;…&#125; | &#123;…&#125;; width?: number | &#123;…&#125; | &#123;…&#125;; height?: number | &#123;…&#125; | &#123;…&#125;; offset?: number | &#123;…&#125; | &#123;…&#125;; fromFloor?: boolean; basis?: &#123;…&#125;; excludes?: "solid"|"foreign_systems"; toStructure?: boolean; endsAtSuspendedCeiling?: boolean; cite?: string &#125;[]; positions?: &#123; id: string; name: string; role: string; envelopes: &#123;…&#125;[] &#125;[] &#125;
- mark?: string
- values?: object
- zone?: string
- levelHint?: string
- spaceHint?: string
- discipline?: string
- note?: string

## record_determination

- determinationId: string
- subject: &#123; kind: "space"|"zone"|"element"|"model"; id?: string &#125;
- key: string
- value: number | string | boolean
- unit?: string
- inputs?: &#123; key: string; elementId?: string; value?: number | string | boolean; unit?: string &#125;[]
- reasoning: string
- decidedBy: string
- decidedAt?: string
- edition?: string
- confidence: "high"|"medium"|"low"
- status?: "draft"|"recorded"

## record_divergence

- divergenceId: string
- designBasis: &#123; elementIds?: string[]; typeIds?: string[]; requirementRefs?: string[] &#125;
- approvedProduct: &#123; label: string; submittalId?: string; itemId?: string &#125;
- notes: string
- responsibleParty?: &#123; label: string; ref?: string &#125;
- responsibilityNote?: string
- at?: string

## record_finding_disposition

- findingId: string
- sourceVersion: string
- action: string
- reason: string
- lineageId?: string
- untilGate?: string
- untilStage?: string
- at?: string

## remove_link_members

- linkId: string
- elementIds: string[]

## remove_viewport

- viewportId: string

## rename_view

- viewId: string
- name: string

## reorder_construction_stages

- stageIds: string[]

## reply_question

- questionId: string
- text: string
- at?: string

## reposition_service_links

- sourceId: string
- moves: &#123; linkId: string; positions: number[] &#125;[]

## resize_riser

- riserId: string
- profile: &#123; shape: "rect"; width: number; height: number &#125; | &#123; shape: "round"; diameter: number &#125;

## resize_run

- segmentId: string
- profile: &#123; shape: "rect"; width: number; height: number &#125; | &#123; shape: "round"; diameter: number &#125; | &#123; shape: "oval"; width: number; height: number &#125; | &#123; shape: "pipe"; nominalMm: number; material: "copper"|"pex"|"cpvc"|"cast_iron"|"pvc"|"abs"|"steel"|"black_steel"|"galvanized"|"pp_r"|"csst"|"pe"; spec?: string; materialId?: string &#125; | &#123; shape: "conduit"; tradeSizeMm: number; conduitType: "emt"|"rmc"|"imc"|"pvc"|"fmc" &#125;

## resize_stretch

- idPrefix: string
- segmentIds: string[]
- fromMm?: number
- toMm?: number
- size: &#123; shape: "rect"; width: number; height: number &#125; | &#123; shape: "round"; diameter: number &#125; | &#123; shape: "oval"; width: number; height: number &#125; | &#123; shape: "pipe"; nominalMm: number; material: "copper"|"pex"|"cpvc"|"cast_iron"|"pvc"|"abs"|"steel"|"black_steel"|"galvanized"|"pp_r"|"csst"|"pe"; spec?: string; materialId?: string &#125; | &#123; shape: "conduit"; tradeSizeMm: number; conduitType: "emt"|"rmc"|"imc"|"pvc"|"fmc" &#125;
- transition?: &#123; family: string; params?: object &#125;

## resize_text_note

- itemId: string
- width: number
- height?: number | null
- at?: &#123; x: number; y: number &#125;

## resize_viewport

- viewportId: string
- size: &#123; x: number; y: number &#125;
- center?: &#123; x: number; y: number &#125;

## restore_document_elements

- items: &#123; elementId: string; before: &#123; id: string; version: number; authoredRev: object; partition?: &#123;…&#125;; deleted?: boolean; kind: "view"; name: string; viewType: "floor_plan"|"ceiling_plan"|"section"|"elevation"|"three_d"|"schedule"|"detail"; cropMin: &#123;…&#125;; cropMax: &#123;…&#125;; props?: &#123;…&#125; &#125; | &#123; id: string; version: number; authoredRev: object; partition?: &#123;…&#125;; deleted?: boolean; kind: "sheet"; number: string; title: string; viewIds: string[]; props?: &#123;…&#125; &#125; | &#123; id: string; version: number; authoredRev: object; partition?: &#123;…&#125;; deleted?: boolean; kind: "viewport"; sheetId: string; viewId: string; center: &#123;…&#125;; size: &#123;…&#125;; scale: number; northArrow?: boolean; titleOffsetMm?: &#123;…&#125;; titleRuleMm?: number &#125; | &#123; id: string; version: number; authoredRev: object; partition?: &#123;…&#125;; deleted?: boolean; kind: "drawing_item"; ownerId: string; shape: "text"|"line"|"rect"|"cloud"|"dimension"|"tag"|"arc"|"circle"|"polyline"|"spline"|"region"|"component"|"repeat"|"batt"|"callout"|"figure"|"field_block"; points: &#123;…&#125;[]; text?: string; textSize?: number; note?: &#123;…&#125;; dim?: &#123;…&#125;; tag?: &#123;…&#125;; callout?: &#123;…&#125;; lineStyle?: &#123;…&#125;; closed?: boolean; ccw?: boolean; fill?: &#123;…&#125;; component?: &#123;…&#125;; batt?: &#123;…&#125;; category?: "detail_lines"|"hatching"|"masking"|"components"|"insulation"|"text"|"dimensions"|"tags"|"clouds"; detailGroup?: string; pinned?: boolean; figure?: &#123;…&#125; | &#123;…&#125;; block?: &#123;…&#125; &#125; | null; expectedVersion: number &#125;[]

## review_submittal

- submittalId: string
- itemId?: string
- state: "pending"|"approved"|"approved_as_noted"|"revise_and_resubmit"|"rejected"
- notes?: string
- at?: string

## rotate_elements

- ids: string[]
- angleDeg: number
- about?: &#123; x: number; y: number &#125;

## route_flex

- segmentId: string
- from: &#123; elementId: string; port: string &#125;
- to: &#123; partId: string; connectorId: string &#125;

## route_into_flex

- route: &#123; idPrefix: string; levelId: string; zone?: string; domain: "duct"|"pipe"|"conduit"; size: &#123; shape: "rect"; width: number; height: number &#125; | &#123; shape: "round"; diameter: number &#125; | &#123; shape: "oval"; width: number; height: number &#125; | &#123; shape: "pipe"; nominalMm: number; material: "copper"|"pex"|"cpvc"|"cast_iron"|"pvc"|"abs"|"steel"|"black_steel"|"galvanized"|"pp_r"|"csst"|"pe"; spec?: string; materialId?: string &#125; | &#123; shape: "conduit"; tradeSizeMm: number; conduitType: "emt"|"rmc"|"imc"|"pvc"|"fmc" &#125;; elevationMm?: number; system: &#123; id: string; kind: unknown; name?: string &#125;; points: &#123; x: number; y: number; elevationMm?: number &#125;[]; riseStyle?: "45"|"60"|"vertical"|"22.5"; from?: &#123; kind: "part"; partId: string; connectorId: string &#125; | &#123; kind: "run_end"; elementId: string; port: string &#125; | &#123; kind: "run_branch"; segmentId: string; face?: "top"|"bottom"; t?: number &#125;; turnAtStart?: boolean; fittings?: object; slopeInPerFt?: number; flow?: "with_points"|"against_points"; insulation?: &#123; kind: "wrap"|"liner"; thicknessMm: number; material?: string; rValue?: number; surface?: "faced"|"spray_coated" &#125; | null &#125;
- to: &#123; partId: string; connectorId: string &#125;

## route_run

- idPrefix: string
- levelId: string
- zone?: string
- domain: "duct"|"pipe"|"conduit"
- size: &#123; shape: "rect"; width: number; height: number &#125; | &#123; shape: "round"; diameter: number &#125; | &#123; shape: "oval"; width: number; height: number &#125; | &#123; shape: "pipe"; nominalMm: number; material: "copper"|"pex"|"cpvc"|"cast_iron"|"pvc"|"abs"|"steel"|"black_steel"|"galvanized"|"pp_r"|"csst"|"pe"; spec?: string; materialId?: string &#125; | &#123; shape: "conduit"; tradeSizeMm: number; conduitType: "emt"|"rmc"|"imc"|"pvc"|"fmc" &#125;
- elevationMm?: number
- system: &#123; id: string; kind: unknown; name?: string &#125;
- points: &#123; x: number; y: number; elevationMm?: number &#125;[]
- riseStyle?: "45"|"60"|"vertical"|"22.5"
- from?: &#123; kind: "part"; partId: string; connectorId: string &#125; | &#123; kind: "run_end"; elementId: string; port: string &#125; | &#123; kind: "run_branch"; segmentId: string; face?: "top"|"bottom"; t?: number &#125;
- to?: &#123; kind: "part"; partId: string; connectorId: string &#125; | &#123; kind: "run_end"; elementId: string; port: string &#125; | &#123; kind: "run_branch"; segmentId: string; face?: "top"|"bottom"; t?: number &#125;
- turnAtStart?: boolean
- capEnd?: boolean
- fittings?: object
- slopeInPerFt?: number
- flow?: "with_points"|"against_points"
- insulation?: &#123; kind: "wrap"|"liner"; thicknessMm: number; material?: string; rValue?: number; surface?: "faced"|"spray_coated" &#125; | null

## save_catalog_entry

- entry: &#123; type: string &#125;
- replaces?: string

## save_connection_type

- entry: &#123; designator: string; trade?: "electrical"|"plumbing"|"gas"|"mechanical"; description?: string; connection?: string; poles?: 1 | 2 | 3; continuous?: boolean; motorHp?: number; comments?: string; quantities?: &#123; wsfu_cold?: number; wsfu_hot?: number; wsfu_total?: number; dfu?: number; gpm_fixed?: number; gph_demand?: number; mbh?: number; min_inlet_pressure?: number; cfm?: number; va?: number; sizes?: &#123;…&#125;; custom?: &#123;…&#125;[] &#125; &#125;
- replaces?: string

## save_part_types

- label?: string
- types: &#123; typeId: string; definition: &#123; familyName: string; typeName: string; category: "mechanical_equipment"|"air_terminal"|"duct_accessory"|"pipe_accessory"|"plumbing_fixture"|"electrical_equipment"|"electrical_device"|"lighting_fixture"|"generic"; description?: string; hosting?: "free"|"wall_face"|"ceiling"|"floor"; typeParams: &#123;…&#125;[]; typeValues: object; instanceParams: &#123;…&#125;[]; connectors: &#123;…&#125;[]; geometry: &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; symbol: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; tagFields: string[]; source: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;; model?: &#123;…&#125; | &#123;…&#125;; clearances?: &#123;…&#125;[]; positions?: &#123;…&#125;[] &#125; &#125;[]

## set_3d_crop_box

- viewId: string
- box?: &#123; center: &#123; x: number; y: number; z: number &#125;; halfSize: &#123; x: number; y: number; z: number &#125;; rotationDeg: number &#125;
- fit?: "selection"|"model"
- elementIds?: string[]
- region?: &#123; min: &#123; x: number; y: number; z: number &#125;; max: &#123; x: number; y: number; z: number &#125; &#125;
- extent?: &#123; min: &#123; x: number; y: number; z: number &#125;; max: &#123; x: number; y: number; z: number &#125; &#125;
- enabled?: boolean
- show?: boolean
- align?: "working_angle" | &#123; from: &#123; x: number; y: number &#125;; to: &#123; x: number; y: number &#125; &#125;

## set_3d_view_camera

- viewId: string
- camera: &#123; eye: &#123; x: number; y: number; z: number &#125;; target: &#123; x: number; y: number; z: number &#125;; up: &#123; x: number; y: number; z: number &#125;; fovDeg: number; orthoHeightMm: number &#125;
- projection?: "perspective"|"orthographic"

## set_active_group

- groupId: string

## set_active_phase

- phaseId: string

## set_classification

- elementIds: string[]
- system: string
- code: string

## set_construction_stage

- elementIds: string[]
- stageId: string | null

## set_element_class

- elementIds: string[]
- classId: string | null

## set_element_linked_copy

- stamps: &#123; elementId: string; stamp: &#123; linkId: string; globalId: string; version: string; fingerprint: string &#125; | null &#125;[]

## set_element_phases

- ids: string[]
- phaseCreated?: string
- phaseDemolished?: string | null

## set_element_placement

- elementId: string
- placement: &#123; kind: "point"; levelId: string; position: &#123; x: number; y: number &#125;; offsetMm: number; rotationDeg: number &#125; | &#123; kind: "line"; levelId: string; start: &#123; x: number; y: number &#125;; end: &#123; x: number; y: number &#125;; startOffsetMm: number; endOffsetMm: number; lateral: "left"|"center"|"right"; vertical: "top"|"center"|"bottom"; rollDeg?: number; topLevelId?: string; topOffsetMm?: number; topSurface?: &#123; to: "structure"|"ceiling"|"roof"|"floor"; elementId?: string; face?: "top"|"underside"; offsetMm?: number &#125;; baseSurface?: &#123; to: "structure"|"ceiling"|"roof"|"floor"; elementId?: string; face?: "top"|"underside"; offsetMm?: number &#125; &#125; | &#123; kind: "path"; levelId: string; start: &#123; x: number; y: number &#125;; segments: &#123; kind: "line"; to: &#123;…&#125; &#125; | &#123; kind: "arc"; to: &#123;…&#125;; bulge: number &#125;[]; startStationMm?: number; profile?: &#123; stationMm: number; elevationMm: number &#125;[]; offsetMm: number; lateral: "left"|"center"|"right" &#125; | &#123; kind: "area"; levelId: string; outline: &#123; x: number; y: number &#125;[]; holes?: &#123; x: number; y: number &#125;[][]; offsetMm: number; vertical: "top"|"center"|"bottom"; spanDirectionDeg?: number; slope?: &#123; directionDeg: number; rise: number &#125; &#125; | null
- heightMm?: number

## set_element_thickness

- elementIds: string[]
- thicknessMm: number

## set_element_type

- elementIds: string[]
- typeId: string | null

## set_element_values

- elementIds: string[]
- values: object

## set_fitting_coefficient

- fittingId: string
- role: "body"|"branch"|"main"
- c: number | null
- by: string
- at: string
- note?: string

## set_group_typical

- groupId: string
- label?: string
- mark?: string
- basePoint?: &#123; x: number; y: number &#125;
- copies?: &#123; mark: string; offset: &#123; x: number; y: number &#125;; rotationDeg?: number; mirror?: &#123; axis: "x"|"y" &#125; &#125;[]
- array?: &#123; count: number; columns: number; spacingMm: &#123; x: number; y: number &#125; &#125;
- phaseRotation?: "rotate"|"same"

## set_level_linked_storey

- levelId: string
- linkId: string
- storeyName: string | null

## set_load_allocation_policy

- policy: "max"|"actual_only"|"allocation_only"

## set_model_addon

- packId: string
- version: string
- on: boolean
- digest?: string
- tier?: string

## set_mounting_plane

- planeId: string
- name?: string
- heightMm?: number
- corner1?: &#123; x: number; y: number &#125;
- corner2?: &#123; x: number; y: number &#125;

## set_parameters

- id: string
- scope: "instance"|"type"
- values?: object
- mark?: string
- mount?: "as_drawn"|"turned_over"|"on_side"
- intakes?: object

## set_part_clearances

- id: string
- scope: "instance"|"type"
- zones?: &#123; id: string; name: string; purpose: string; face: "front"|"back"|"left"|"right"|"top"|"bottom"; depth: number | &#123; param: string; scale?: number; add?: number &#125; | &#123; formula: string &#125;; width?: number | &#123; param: string; scale?: number; add?: number &#125; | &#123; formula: string &#125;; height?: number | &#123; param: string; scale?: number; add?: number &#125; | &#123; formula: string &#125;; offset?: number | &#123; param: string; scale?: number; add?: number &#125; | &#123; formula: string &#125;; fromFloor?: boolean; basis?: &#123; code: "nec_110_26"; edition: "2020"|"2023"; voltageToGround: number; condition: 1 | 2 | 3; depthMultiplier?: number &#125;; excludes?: "solid"|"foreign_systems"; toStructure?: boolean; endsAtSuspendedCeiling?: boolean; cite?: string &#125;[]
- overrides?: object

## set_part_host

- ids: string[]
- host: &#123; kind: "slab"; elementId: string &#125; | &#123; kind: "linked"; referenceId: string; globalId?: string; localId?: number; name: string; surface?: "slab"|"roof"; topMm: number &#125; | &#123; kind: "element"; elementId: string; stationMm: number &#125; | &#123; kind: "wall_face"; elementId: string; stationMm: number; side: 1 | -1; faceOffsetMm?: number &#125; | null
- curbMm?: number | null
- seat?: boolean

## set_pipe_insulation

- systemId: string
- label?: string
- pieces: &#123; segmentId: string; insulation: &#123; kind: "wrap"|"liner"; thicknessMm: number; material?: string; rValue?: number; surface?: "faced"|"spray_coated" &#125; | null &#125;[]

## set_pipe_sizes

- idPrefix: string
- systemId: string
- label?: string
- sizes: &#123; segmentId: string; nominalIn: number &#125;[]

## set_print_black_only

- blackOnly: boolean

## set_project_origin

- mode: "move_point"|"relocate_project"
- position?: &#123; x: number; y: number; z: number &#125;
- shared?: &#123; eastWest: number; northSouth: number; elevation: number &#125;

## set_project_parameters

- values: object
- define?: &#123; key: string; label: string; valueType: "text"|"date"|"choice"; choices?: string[] &#125;[]

## set_question_status

- questionIds: string[]
- status: "open"|"withdrawn"
- at?: string

## set_requirement_state

- requirementId: string
- status: "verified"|"overridden"|"withdrawn"|"proposed"
- value?: number | string | boolean
- unit?: string
- reason?: string
- by: string
- at?: string

## set_run_insulation

- elementId: string
- insulation: &#123; kind: "wrap"|"liner"; thicknessMm: number; material?: string; rValue?: number; surface?: "faced"|"spray_coated" &#125; | null
- scope: "piece"|"run"|"system"

## set_sheet_properties

- sheetId: string
- number?: string
- name?: string
- titleBlock?: "arch_d_mutinybim"|"ansi_b_mutinybim"
- titleBlockRow?: &#123; id: string; revision: number; name: string; definition: &#123; schema: 1; paperName: string; paperMm: &#123;…&#125;; marginsMm: &#123;…&#125;; stripWidthMm: number; colors: &#123;…&#125;; fonts: &#123;…&#125;; lines: &#123;…&#125;; slots: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[] &#125; &#125; | null
- fields?: object
- revisions?: &#123; number: string; date: string; description: string &#125;[]

## set_slope

- segmentId: string
- inPerFt?: number
- flow?: "toward_start"|"toward_end"
- keep?: "upstream"|"downstream"

## set_stack_checks

- baseClearanceDiameters: number | null

## set_stage_plan

- stageSetId: string
- stageSetVersion: string
- currentStageId?: string
- setBy?: string
- setAt?: string

## set_survey_point

- mode: "move_point"|"relocate_project"
- position?: &#123; x: number; y: number; z: number &#125;
- shared?: &#123; eastWest: number; northSouth: number; elevation: number &#125;

## set_system_design

- systemId: string
- name?: string
- design?: &#123; altitudeM?: number; temperatureC?: number; material?: "galvanized"|"aluminum"|"stainless"|"pvc_coated"|"fiberglass_board"|"lined"|"flexible"; frictionMethod?: "colebrook"|"altshul_tsal"; pipe?: &#123; frictionMethod?: "hazen_williams"|"darcy"; fittingMethod?: "k"|"equivalent_length"; hazenC?: number; waterTempF?: number; supplyPressurePsi?: number; fixedLossesPsi?: number; minFixturePressurePsi?: number; maxVelocityFps?: number; demandMethod?: "table"|"hunter_formula"|"flow_is_gpm"; demandTable?: &#123;…&#125;[]; fixtureTable?: &#123;…&#125;[]; slopes?: &#123;…&#125;[]; fillRatio?: number; manningN?: number; drainFlowTable?: &#123;…&#125;[]; capacityTable?: &#123;…&#125;[]; directionRules?: &#123;…&#125;[]; rainfallInPerHr?: number; gasEquation?: "spitzglass"|"mueller"; specificGravity?: number; heatingValueBtuPerCf?: number; inletPressureInWc?: number; allowableDropInWc?: number; gasSizing?: "longest_run"|"actual_length"|"branch_length"; gasType?: "natural"|"propane"; sizingMode?: "check"|"auto" | null; demandCurve?: "ashrae_a"|"ashrae_b"|"ashrae_c"|"ashrae_d"|"ipc_e_tank"|"ipc_e_valve"|"firm"|"legacy_fit" | null &#125;; insulation?: &#123; kind: "wrap"|"liner"; thicknessMm: number; material?: string; rValue?: number; surface?: "faced"|"spray_coated" &#125; | null; sizing?: &#123; frictionInPer100Ft?: number; maxVelocityFpm?: number; maxAspectRatio?: number &#125; | null &#125;
- fittingDefaults?: object
- coefficientTable?: &#123; id: string; label: string; scope: "firm"|"project"; entries: &#123; family: string; role: "body"|"branch"|"main"; c?: number; variable?: "r_over_w"|"angle_deg"|"area_ratio"|"velocity_ratio"|"aspect_ratio"; points?: &#123;…&#125;[]; when?: object; note?: string &#125;[] &#125; | null

## set_system_graphics

- systemId: string
- colour?: string | null
- pattern?: "solid"|"dashed"|"dotted"|"dash_dot"|"dash_dot_dot"|"dash_dot_dot_dot"|"long_dash" | null
- weight?: "thin"|"medium"|"wide"|"heavy" | null
- lineCode?: string | null

## set_tag_text

- tagId: string
- text: string

## set_terminal_cfm

- terminalId: string
- cfm: number

## set_true_north

- angleDeg?: number
- from?: &#123; x: number; y: number &#125;
- to?: &#123; x: number; y: number &#125;

## set_typical_cap

- cap: number

## set_view_crop

- viewId: string
- crop?: &#123; min: &#123; x: number; y: number &#125;; max: &#123; x: number; y: number &#125; &#125;
- fit?: true
- cropView?: boolean
- showCropBox?: boolean
- annotationCrop?: boolean
- annotationCropOffsetMm?: number
- levelLeftExtMm?: number
- levelRightExtMm?: number
- section?: &#123; start: &#123; x: number; y: number &#125;; end: &#123; x: number; y: number &#125;; direction: 1 | -1; depthMm: number; headExtMm?: number; tailExtMm?: number; splitGap?: boolean &#125;
- farClipMm?: number
- keepViewportCenter?: boolean

## set_view_properties

- viewId: string
- props: &#123; level?: string; levelElevationMm?: number; scale?: number; cutHeightMm?: number; viewDepthMm?: number; viewBottomMm?: number | null; viewTopMm?: number | null; discipline?: string|null; hiddenCategories?: "duct"|"duct_fitting"|"pipe"|"air_terminal"|"equipment"|"walls"|"doors_windows"|"rooms"|"grids"|"structure"|"tags"|"dimensions"|"electrical_devices"|"lighting_fixtures"|"electrical_equipment"|"insulation"[]; hiddenDraftingCategories?: "detail_lines"|"hatching"|"masking"|"components"|"insulation"|"text"|"dimensions"|"tags"|"clouds"[]; references?: object; linkedHiddenLines?: boolean; linkedMinObjectMm?: number; detailLevel?: "coarse"|"medium"|"fine"; showLineCodes?: boolean; symbolScale?: number; visualStyle?: "wireframe"|"hidden_line"|"shaded"|"shaded_edges"; showHiddenLines?: boolean; hiddenLineCategories?: "duct"|"duct_fitting"|"pipe"|"air_terminal"|"equipment"|"walls"|"doors_windows"|"rooms"|"grids"|"structure"|"tags"|"dimensions"|"electrical_devices"|"lighting_fixtures"|"electrical_equipment"|"insulation"[]; lineWeights?: object; categoryOverrides?: object; cutPattern?: "cross"|"solid"|"hatch"; section?: &#123; start: &#123;…&#125;; end: &#123;…&#125;; direction: 1 | -1; depthMm: number; headExtMm?: number; tailExtMm?: number; splitGap?: boolean &#125;; cropView?: boolean; showCropBox?: boolean; annotationCrop?: boolean; annotationCropOffsetMm?: number; levelLeftExtMm?: number; levelRightExtMm?: number; phaseId?: string; phaseFilterId?: string; groupDisplay?: object; orientation?: "plan_north"|"true_north"|"working_angle"; workingAngleDeg?: number | null; projection?: "perspective"|"orthographic"; schedule?: &#123; category: "mechanical_equipment"|"air_terminal"|"duct_accessory"|"pipe_accessory"|"plumbing_fixture"|"electrical_equipment"|"electrical_device"|"lighting_fixture"|"generic"|"sheet_list"|"duct"|"pipe"; title?: string; columns: &#123;…&#125;[]; sort?: &#123;…&#125;[]; filters?: &#123;…&#125;[]; level?: string; itemize?: boolean; textSizeMm?: number; emptyText?: string &#125;; formSchedule?: &#123; kind: string; elementId?: string; template: &#123;…&#125;; rules?: string; textSizeMm?: number; emptyText?: string; templateSource?: &#123;…&#125; &#125;; scheduleV2?: &#123; name: string; source: &#123;…&#125; | &#123;…&#125; | &#123;…&#125;; columns: &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125; | &#123;…&#125;[]; filters: &#123;…&#125;[]; sort: &#123;…&#125;[]; groups: &#123;…&#125;[]; grandTotals: boolean; itemize: boolean; presentation: &#123;…&#125; | &#123;…&#125;; display: &#123;…&#125;; pins?: &#123;…&#125;[] &#125;; diagram?: &#123; kind: string; hints?: &#123;…&#125; &#125; &#125;
- crop?: &#123; min: &#123; x: number; y: number &#125;; max: &#123; x: number; y: number &#125; &#125;
- keepViewportCenter?: boolean

## set_viewport_north_arrow

- viewportId: string
- show: boolean

## set_viewport_scale

- viewportId: string
- scale: number

## set_viewport_title

- viewportId: string
- titleOffsetMm?: &#123; x: number; y: number &#125;
- titleRuleMm?: number | null

## set_working_angle

- angleDeg?: number
- from?: &#123; x: number; y: number &#125;
- to?: &#123; x: number; y: number &#125;

## slide_branch

- tapId: string
- s: number

## split_load

- loadId?: string
- loadPointId?: string
- into: &#123; id: string; anchor?: &#123; kind: "none" &#125; | &#123; kind: "space"; id: string &#125; | &#123; kind: "zone"; id: string &#125; | &#123; kind: "run_end"; hostId: string; port: string &#125; | &#123; kind: "point"; levelId: string; position: &#123;…&#125; &#125; | &#123; kind: "part"; partId: string; connector?: string &#125;; connectionType?: string; values: &#123; wsfu_cold?: number; wsfu_hot?: number; wsfu_total?: number; dfu?: number; gpm_fixed?: number; gph_demand?: number; mbh?: number; min_inlet_pressure?: number; cfm?: number; va?: number; sizes?: &#123;…&#125;; custom?: &#123;…&#125;[] &#125;; mark?: string; schematic?: boolean; note?: string; service?: "power"|"cold_water"|"hot_water"|"sanitary"|"grease_waste"|"gas"|"supply_air"|"outside_air"|"exhaust_air"|"heat_gain"; basis?: "lump"|"density"|"count"|"calc"; rates?: &#123; key: "wsfu_cold"|"wsfu_hot"|"wsfu_total"|"dfu"|"gpm_fixed"|"gph_demand"|"mbh"|"min_inlet_pressure"|"cfm"|"va"; per: "area"|"occupant"; value: number &#125;[]; count?: number; servedBy?: string; source?: &#123; kind: "code"|"calc"|"engineer"|"client"|"vendor_doc"; ref: string &#125;; future?: boolean &#125;[]

## split_load_point

- loadPointId: string
- into: &#123; hostId: string; port: string; connectionType?: string; values: &#123; wsfu_cold?: number; wsfu_hot?: number; wsfu_total?: number; dfu?: number; gpm_fixed?: number; gph_demand?: number; mbh?: number; min_inlet_pressure?: number; cfm?: number; va?: number; sizes?: &#123;…&#125;; custom?: &#123;…&#125;[] &#125;; mark?: string; schematic?: boolean; note?: string &#125;[]

## split_run

- idPrefix: string
- segmentId: string
- atMm: number

## split_space

- spaceId: string
- line: &#123; start: &#123; x: number; y: number &#125;; end: &#123; x: number; y: number &#125; &#125;
- separatorId?: string
- childIds?: string[]
- typedLoadsTo?: string
- loadsTo?: &#123; loadId: string; to: string &#125;[]

## stretch_to_side

- from: &#123; elementId: string; port: string &#125;
- onto: string
- idPrefix: string

## supersede_determination

- determinationId: string
- newDeterminationId: string
- value: number | string | boolean
- unit?: string
- inputs?: &#123; key: string; elementId?: string; value?: number | string | boolean; unit?: string &#125;[]
- reasoning: string
- decidedBy: string
- decidedAt?: string
- edition?: string
- confidence: "high"|"medium"|"low"

## swap_fitting

- fittingId: string
- family: string
- params?: object

## sync_levels

- referenceId: string
- storeys: &#123; storeyId: string; name: string; elevationMm: number; levelId: string &#125;[]

## take_over_question

- questionId: string
- note?: string
- at?: string

## undemolish_elements

- ids: string[]

## undo

- revision: number

## unlock_elements

- elementIds: string[]

## unpin_firm_discipline

- disciplineId: string

## unplace_part

- partId: string
- note?: string

## update_drawing_item

- itemId: string
- points?: &#123; x: number; y: number &#125;[]
- text?: string
- dim?: &#123; kind: "linear"|"aligned"|"angular"|"radial"|"diameter"|"arc_length"|"spot_elevation"|"spot_coordinate"; direction?: "horizontal"|"vertical"; chain?: "continuous"|"baseline"; refs?: &#123; elementId: string; anchor: "start"|"end"|"mid"|"center"|"insertion"|"edge_left"|"edge_right"; index?: number &#125; | null[]; offsetMm: number; textOverride?: string; prefix?: string; suffix?: string; style?: &#123; units?: "ft_in"|"in"|"mm"|"m"; roundTo?: number; terminator?: "tick"|"arrow"|"dot"; textSizeMm?: number &#125; &#125;
- tag?: &#123; elementId: string; template: "auto"|"duct_size"|"duct_size_insulation"|"pipe_size"|"pipe_size_insulation"|"mark"|"air_terminal"|"equipment"|"fixture"|"fields"|"gas_pipe"|"name_number"; fields?: string[]; leader: boolean; leaderOverride?: boolean; mask?: boolean; textSizeMm?: number; styleId?: string; elbow?: "auto" | &#123; x: number; y: number &#125; &#125;
- callout?: &#123; viewId: string; label?: string &#125;
- lineStyle?: &#123; weight?: "thin"|"medium"|"wide"|"heavy"; pattern?: "solid"|"dashed"|"hidden"|"center"|"phantom"|"dotted" &#125;
- closed?: boolean
- ccw?: boolean
- fill?: &#123; pattern: "solid"|"diagonal"|"diagonal_reverse"|"crosshatch"|"horizontal"|"vertical"|"dots"|"concrete"|"earth"|"insulation_rigid"|"masonry"; spacingMm?: number; grey?: number; masking?: boolean; boundary?: boolean &#125;
- component?: &#123; symbolId: string; widthMm?: number; heightMm?: number; rotationDeg?: number; mirror?: boolean; spacingMm?: number &#125;
- batt?: &#123; thicknessMm: number &#125;
- category?: "detail_lines"|"hatching"|"masking"|"components"|"insulation"|"text"|"dimensions"|"tags"|"clouds"
- detailGroup?: string | null
- pinned?: boolean
- figure?: &#123; kind: "chart"; chart: string; params?: object; title?: string &#125; | &#123; kind: "image"; image: &#123; fileId: string; name: string; mime: "image/png"|"image/jpeg" &#125; &#125;

## update_group

- groupId: string
- name?: string
- color?: string
- description?: string
- defaultVisibility?: "show"|"halftone"|"hide"

## update_level

- levelId: string
- name?: string
- elevationMm?: number

## update_phase

- phaseId: string
- name?: string
- after?: string | null

## update_phase_filter

- filterId: string
- name?: string
- statuses?: &#123; new?: "show"|"halftone"|"dashed"|"hide"; existing?: "show"|"halftone"|"dashed"|"hide"; demolished?: "show"|"halftone"|"dashed"|"hide"; temporary?: "show"|"halftone"|"dashed"|"hide" &#125;

## update_tag_style

- styleId: string
- name?: string
- lines?: string[]
- textSizeMm?: number
- leader?: boolean
- box?: "box"|"none"|"rounded"|"circle"|"hexagon"|"diamond"
- defaultFor?: "duct"|"pipe"|"air_terminal"|"equipment"|"fixture"|"part"|"room"|"space"[]
- prefix?: string
- suffix?: string
- orientation?: "horizontal"|"along"
- units?: "ft_in"|"ft"|"in"|"mm"|"m"
- leaderEnd?: "dot"|"arrow"|"tick"|"none"
- appliesTo?: "duct"|"pipe"|"air_terminal"|"equipment"|"fixture"|"part"|"room"|"space"[]
- arrow?: "none"|"down_slope"|"up_slope"
- mask?: boolean
- textStyleId?: string

## update_text_style

- styleId: string
- name?: string
- textSizeMm?: number
- fontFamily?: string
- bold?: boolean
- italic?: boolean
- uppercase?: boolean
- background?: "transparent"|"opaque"
- color?: string | ""
- defaultFor?: "part_mark"|"link_label"|"tag"|"dimension"|"note"|"space_label"[]
