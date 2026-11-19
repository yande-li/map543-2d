(module
 (type $0 (func))
 (type $1 (func (param i32 i32 i32 i32)))
 (type $2 (func (param i32)))
 (type $3 (func (param i32) (result i32)))
 (type $4 (func (param i32 i32) (result i32)))
 (type $5 (func (param f32 f32 f32 i32 i32 i32 i32 f32 f32 f32 f32 f32) (result i32)))
 (type $6 (func (param i32 i32 i32 i32 i32 f32 f32 f32 f32) (result i32)))
 (type $7 (func (param i32 i32 i32 i32 i32) (result i32)))
 (type $8 (func (param i32 i32 i32 i32 i32 i32 f32 f32 f32 f32 f32 f32 f32 f32 f32) (result i32)))
 (type $9 (func (param i32 i32 i32 i32 i32 i32) (result i32)))
 (type $10 (func (param i32 i32 i32 i32 i32 i32 f64 i32) (result i32)))
 (type $11 (func (param i32 i32 i32 i32 i32 i32 i32) (result i32)))
 (import "env" "abort" (func $~lib/builtins/abort (param i32 i32 i32 i32)))
 (global $~lib/rt/stub/offset (mut i32) (i32.const 0))
 (global $~lib/rt/__rtti_base i32 (i32.const 1168))
 (memory $0 8 512)
 (data $0 (i32.const 1036) "<")
 (data $0.1 (i32.const 1048) "\02\00\00\00(\00\00\00A\00l\00l\00o\00c\00a\00t\00i\00o\00n\00 \00t\00o\00o\00 \00l\00a\00r\00g\00e")
 (data $1 (i32.const 1100) "<")
 (data $1.1 (i32.const 1112) "\02\00\00\00\1e\00\00\00~\00l\00i\00b\00/\00r\00t\00/\00s\00t\00u\00b\00.\00t\00s")
 (data $2 (i32.const 1168) "\04\00\00\00 \00\00\00 \00\00\00 ")
 (export "findNearestPointBatch" (func $wasm/kernels/findNearestPointBatch))
 (export "batchProjectMercator" (func $wasm/kernels/batchProjectMercator))
 (export "decimateRingsBatch" (func $wasm/kernels/decimateRingsBatch))
 (export "cleanSeamRingBatch" (func $wasm/kernels/cleanSeamRingBatch))
 (export "computeQuadraticArcsBatch" (func $wasm/kernels/computeQuadraticArcsBatch))
 (export "decodeGeobufRingMercator" (func $wasm/kernels/decodeGeobufRingMercator))
 (export "decodeLocationDictBatch" (func $wasm/kernels/decodeLocationDictBatch))
 (export "projectInterleavedMercator" (func $wasm/kernels/projectInterleavedMercator))
 (export "__new" (func $~lib/rt/stub/__new))
 (export "__pin" (func $~lib/rt/stub/__pin))
 (export "__unpin" (func $~lib/rt/stub/__unpin))
 (export "__collect" (func $~lib/rt/stub/__collect))
 (export "__rtti_base" (global $~lib/rt/__rtti_base))
 (export "memory" (memory $0))
 (start $~start)
 (func $~start
  i32.const 1196
  global.set $~lib/rt/stub/offset
 )
 (func $~lib/rt/stub/__unpin (param $0 i32)
 )
 (func $~lib/rt/stub/__pin (param $0 i32) (result i32)
  local.get $0
 )
 (func $~lib/rt/stub/__new (param $0 i32) (param $1 i32) (result i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  local.get $0
  i32.const 1073741804
  i32.gt_u
  if
   i32.const 1056
   i32.const 1120
   i32.const 86
   i32.const 30
   call $~lib/builtins/abort
   unreachable
  end
  local.get $0
  i32.const 16
  i32.add
  local.tee $3
  i32.const 1073741820
  i32.gt_u
  if
   i32.const 1056
   i32.const 1120
   i32.const 33
   i32.const 29
   call $~lib/builtins/abort
   unreachable
  end
  global.get $~lib/rt/stub/offset
  i32.const 4
  i32.add
  local.tee $2
  local.get $3
  i32.const 19
  i32.add
  i32.const -16
  i32.and
  i32.const 4
  i32.sub
  local.tee $3
  i32.add
  local.tee $4
  memory.size
  local.tee $5
  i32.const 16
  i32.shl
  i32.const 15
  i32.add
  i32.const -16
  i32.and
  local.tee $6
  i32.gt_u
  if
   local.get $5
   local.get $4
   local.get $6
   i32.sub
   i32.const 65535
   i32.add
   i32.const -65536
   i32.and
   i32.const 16
   i32.shr_u
   local.tee $6
   local.get $5
   local.get $6
   i32.gt_s
   select
   memory.grow
   i32.const 0
   i32.lt_s
   if
    local.get $6
    memory.grow
    i32.const 0
    i32.lt_s
    if
     unreachable
    end
   end
  end
  global.get $~lib/rt/stub/offset
  local.get $4
  global.set $~lib/rt/stub/offset
  local.get $3
  i32.store
  local.get $2
  i32.const 4
  i32.sub
  local.tee $3
  i32.const 0
  i32.store offset=4
  local.get $3
  i32.const 0
  i32.store offset=8
  local.get $3
  local.get $1
  i32.store offset=12
  local.get $3
  local.get $0
  i32.store offset=16
  local.get $2
  i32.const 16
  i32.add
 )
 (func $~lib/rt/stub/__collect
 )
 (func $wasm/kernels/findNearestPointBatch (param $0 f32) (param $1 f32) (param $2 f32) (param $3 i32) (param $4 i32) (param $5 i32) (param $6 i32) (param $7 f32) (param $8 f32) (param $9 f32) (param $10 f32) (param $11 f32) (result i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 f32)
  (local $17 f32)
  (local $18 f32)
  local.get $3
  i32.const 0
  i32.le_s
  local.get $2
  f32.const 0
  f32.lt
  i32.or
  if
   i32.const -1
   return
  end
  i32.const -1
  local.set $13
  loop $for-loop|0
   local.get $3
   local.get $12
   i32.gt_s
   if
    local.get $12
    i32.const 2
    i32.shl
    local.tee $14
    local.get $6
    i32.add
    f32.load
    f32.const 180
    f32.add
    f32.const 2.7777778450399637e-03
    f32.mul
    local.get $7
    f32.sub
    local.get $9
    f32.mul
    local.get $10
    f32.add
    local.get $0
    f32.sub
    local.tee $16
    local.get $16
    f32.mul
    local.tee $16
    local.get $2
    f32.le
    if
     block $wasm/kernels/clampLat|inlined.0 (result f32)
      f32.const 85.05113220214844
      local.get $5
      local.get $14
      i32.add
      f32.load
      local.tee $17
      f32.const 85.05113220214844
      f32.gt
      br_if $wasm/kernels/clampLat|inlined.0
      drop
      f32.const -85.05113220214844
      local.get $17
      f32.const -85.05113220214844
      f32.lt
      br_if $wasm/kernels/clampLat|inlined.0
      drop
      local.get $17
     end
     local.tee $17
     f32.neg
     local.get $17
     local.get $17
     f32.const 0
     f32.lt
     select
     f32.const 60
     f32.mul
     local.tee $18
     i32.trunc_sat_f32_s
     local.tee $14
     i32.const 5400
     i32.ge_s
     if
      i32.const 5399
      local.set $14
     end
     f32.const 0.5
     local.get $4
     local.get $14
     i32.const 2
     i32.shl
     i32.add
     local.tee $15
     f32.load
     local.tee $18
     local.get $15
     f32.load offset=4
     local.get $18
     f32.sub
     local.get $17
     f32.neg
     local.get $17
     local.get $17
     f32.const 0
     f32.lt
     select
     f32.const 60
     f32.mul
     local.get $14
     f32.convert_i32_s
     f32.sub
     f32.mul
     f32.add
     local.tee $18
     f32.neg
     local.get $18
     local.get $17
     f32.const 0
     f32.lt
     select
     f32.const 0.15915493667125702
     f32.mul
     f32.sub
     local.get $8
     f32.sub
     local.get $9
     f32.mul
     local.get $11
     f32.add
     local.get $1
     f32.sub
     local.tee $17
     local.get $17
     f32.mul
     local.get $16
     f32.add
     local.tee $16
     local.get $2
     f32.le
     if
      local.get $12
      local.set $13
      local.get $16
      local.set $2
     end
    end
    local.get $12
    i32.const 1
    i32.add
    local.set $12
    br $for-loop|0
   end
  end
  local.get $13
 )
 (func $wasm/kernels/decimateRingsBatch (param $ringCount i32) (param $inXYPtr i32) (param $ringLensPtr i32) (param $outXYPtr i32) (param $outLensPtr i32) (param $scale f32) (param $offsetX f32) (param $offsetY f32) (param $pixelStep f32) (result i32)
  (local $normStep f32)
  (local $lastNx f32)
  (local $lastNy f32)
  (local $nx f32)
  (local $ny f32)
  (local $r i32)
  (local $ringLen i32)
  (local $inPtr i32)
  (local $ringEndPtr i32)
  (local $lastPtPtr i32)
  (local $outPtr i32)
  (local $outRingFloats i32)
  (local $totalOutFloats i32)
  (if (i32.le_s (local.get $ringCount) (i32.const 0))
   (then (return (i32.const 0)))
  )
  (if (f32.gt (local.get $scale) (f32.const 0))
   (then
    (local.set $normStep (f32.div (local.get $pixelStep) (local.get $scale)))
   )
   (else
    (local.set $normStep (f32.const 0))
   )
  )
  (local.set $inPtr (local.get $inXYPtr))
  (local.set $outPtr (local.get $outXYPtr))
  (local.set $r (i32.const 0))
  (local.set $totalOutFloats (i32.const 0))
  (loop $ring_loop
   (if (i32.lt_s (local.get $r) (local.get $ringCount))
    (then
     (local.set $ringLen
      (i32.load (i32.add (local.get $ringLensPtr) (i32.shl (local.get $r) (i32.const 2))))
     )
     (if (i32.lt_s (local.get $ringLen) (i32.const 2))
      (then
       (i32.store
        (i32.add (local.get $outLensPtr) (i32.shl (local.get $r) (i32.const 2)))
        (i32.const 0)
       )
       (if (i32.gt_s (local.get $ringLen) (i32.const 0))
        (then
         (local.set $inPtr
          (i32.add (local.get $inPtr) (i32.shl (local.get $ringLen) (i32.const 2)))
         )
        )
       )
      )
      (else
       (local.set $ringEndPtr
        (i32.add (local.get $inPtr) (i32.shl (local.get $ringLen) (i32.const 2)))
       )
       (local.set $lastPtPtr (i32.sub (local.get $ringEndPtr) (i32.const 8)))
       (local.set $lastNx (f32.load (local.get $inPtr)))
       (local.set $lastNy (f32.load offset=4 (local.get $inPtr)))
       (f32.store
        (local.get $outPtr)
        (f32.sub (f32.mul (local.get $lastNx) (local.get $scale)) (local.get $offsetX))
       )
       (f32.store offset=4
        (local.get $outPtr)
        (f32.sub (f32.mul (local.get $lastNy) (local.get $scale)) (local.get $offsetY))
       )
       (local.set $outPtr (i32.add (local.get $outPtr) (i32.const 8)))
       (local.set $outRingFloats (i32.const 2))
       (local.set $inPtr (i32.add (local.get $inPtr) (i32.const 8)))
       (loop $pt_loop
        (if (i32.lt_u (local.get $inPtr) (local.get $ringEndPtr))
         (then
          (local.set $nx (f32.load (local.get $inPtr)))
          (local.set $ny (f32.load offset=4 (local.get $inPtr)))
          (if
           (i32.or
            (i32.eq (local.get $inPtr) (local.get $lastPtPtr))
            (i32.or
             (f32.ge
              (f32.abs (f32.sub (local.get $nx) (local.get $lastNx)))
              (local.get $normStep)
             )
             (f32.ge
              (f32.abs (f32.sub (local.get $ny) (local.get $lastNy)))
              (local.get $normStep)
             )
            )
           )
           (then
            (f32.store
             (local.get $outPtr)
             (f32.sub (f32.mul (local.get $nx) (local.get $scale)) (local.get $offsetX))
            )
            (f32.store offset=4
             (local.get $outPtr)
             (f32.sub (f32.mul (local.get $ny) (local.get $scale)) (local.get $offsetY))
            )
            (local.set $outPtr (i32.add (local.get $outPtr) (i32.const 8)))
            (local.set $outRingFloats (i32.add (local.get $outRingFloats) (i32.const 2)))
            (local.set $lastNx (local.get $nx))
            (local.set $lastNy (local.get $ny))
           )
          )
          (local.set $inPtr (i32.add (local.get $inPtr) (i32.const 8)))
          (br $pt_loop)
         )
        )
       )
       (i32.store
        (i32.add (local.get $outLensPtr) (i32.shl (local.get $r) (i32.const 2)))
        (local.get $outRingFloats)
       )
       (local.set $totalOutFloats
        (i32.add (local.get $totalOutFloats) (local.get $outRingFloats))
       )
       (local.set $inPtr (local.get $ringEndPtr))
      )
     )
     (local.set $r (i32.add (local.get $r) (i32.const 1)))
     (br $ring_loop)
    )
   )
  )
  (local.get $totalOutFloats)
 )
 (func $wasm/kernels/cleanSeamRingBatch (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (result i32)
  (local $5 i32)
  (local $6 f32)
  (local $7 f32)
  (local $8 f32)
  (local $9 f32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 f32)
  local.get $0
  i32.const 4
  i32.lt_s
  if
   local.get $4
   f32.const inf
   f32.store
   local.get $4
   f32.const inf
   f32.store offset=4
   local.get $4
   f32.const -inf
   f32.store offset=8
   local.get $4
   f32.const -inf
   f32.store offset=12
   i32.const 0
   return
  end
  local.get $1
  f32.load
  local.tee $6
  local.set $8
  local.get $1
  f32.load offset=4
  local.tee $7
  local.set $9
  i32.const 2
  local.set $12
  loop $for-loop|0
   local.get $0
   local.get $12
   i32.gt_s
   if
    local.get $1
    local.get $12
    i32.const 2
    i32.shl
    i32.add
    local.tee $14
    f32.load
    local.tee $15
    local.get $6
    local.get $6
    local.get $15
    f32.gt
    select
    local.set $6
    local.get $15
    local.get $8
    local.get $8
    local.get $15
    f32.lt
    select
    local.set $8
    local.get $14
    f32.load offset=4
    local.tee $15
    local.get $7
    local.get $7
    local.get $15
    f32.gt
    select
    local.set $7
    local.get $15
    local.get $9
    local.get $9
    local.get $15
    f32.lt
    select
    local.set $9
    local.get $12
    i32.const 2
    i32.add
    local.set $12
    br $for-loop|0
   end
  end
  local.get $4
  local.get $6
  f32.store
  local.get $4
  local.get $7
  f32.store offset=4
  local.get $4
  local.get $8
  f32.store offset=8
  local.get $4
  local.get $9
  f32.store offset=12
  loop $for-loop|1
   local.get $13
   local.get $0
   i32.const 2
   i32.sub
   i32.lt_s
   if
    local.get $1
    local.get $13
    i32.const 2
    i32.shl
    i32.add
    local.tee $4
    f32.load
    local.set $6
    local.get $4
    f32.load offset=4
    local.set $7
    local.get $4
    f32.load offset=12
    local.set $8
    local.get $6
    f32.neg
    local.get $6
    local.get $6
    f32.const 0
    f32.lt
    select
    f32.const -180
    f32.add
    local.tee $9
    f32.neg
    local.get $9
    local.get $9
    f32.const 0
    f32.lt
    select
    f32.const 0.5
    f32.lt
    local.get $6
    local.get $4
    f32.load offset=8
    local.tee $9
    f32.sub
    local.tee $15
    f32.neg
    local.get $15
    local.get $15
    f32.const 0
    f32.lt
    select
    local.tee $15
    f32.const 1.0000000474974513e-03
    f32.lt
    local.tee $4
    local.get $4
    select
    local.get $15
    f32.const 180
    f32.gt
    i32.or
    if (result i32)
     local.get $5
     i32.const 0
     i32.gt_s
     if (result i32)
      local.get $3
      local.get $10
      i32.const 2
      i32.shl
      i32.add
      local.get $5
      i32.store
      local.get $10
      i32.const 1
      i32.add
      local.set $10
      i32.const 0
     else
      local.get $5
     end
    else
     local.get $5
     i32.eqz
     if
      local.get $2
      local.get $11
      i32.const 2
      i32.shl
      i32.add
      local.tee $4
      local.get $6
      f32.store
      local.get $4
      local.get $7
      f32.store offset=4
      local.get $11
      i32.const 2
      i32.add
      local.set $11
      local.get $5
      i32.const 2
      i32.add
      local.set $5
     end
     local.get $2
     local.get $11
     i32.const 2
     i32.shl
     i32.add
     local.tee $4
     local.get $9
     f32.store
     local.get $4
     local.get $8
     f32.store offset=4
     local.get $11
     i32.const 2
     i32.add
     local.set $11
     local.get $5
     i32.const 2
     i32.add
    end
    local.set $5
    local.get $13
    i32.const 2
    i32.add
    local.set $13
    br $for-loop|1
   end
  end
  local.get $5
  i32.const 0
  i32.gt_s
  if (result i32)
   local.get $3
   local.get $10
   i32.const 2
   i32.shl
   i32.add
   local.get $5
   i32.store
   local.get $10
   i32.const 1
   i32.add
  else
   local.get $10
  end
 )
 (func $wasm/kernels/batchProjectMercator (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32) (param $6 f32) (param $7 f32) (param $8 f32) (param $9 f32) (param $10 f32) (param $11 f32) (param $12 f32) (param $13 f32) (param $14 f32) (result i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 f32)
  (local $19 f32)
  (local $20 f32)
  (local $21 i32)
  (local $22 f32)
  local.get $0
  i32.const 0
  i32.le_s
  if
   i32.const 0
   return
  end
  loop $for-loop|0
   local.get $0
   local.get $17
   i32.gt_s
   if
    local.get $17
    i32.const 2
    i32.shl
    local.tee $16
    local.get $3
    i32.add
    f32.load
    f32.const 180
    f32.add
    f32.const 2.7777778450399637e-03
    f32.mul
    local.get $6
    f32.sub
    local.get $8
    f32.mul
    local.get $9
    f32.add
    local.tee $18
    local.get $11
    f32.ge
    local.get $13
    local.get $18
    f32.ge
    i32.and
    if
     block $wasm/kernels/clampLat|inlined.1 (result f32)
      f32.const 85.05113220214844
      local.get $2
      local.get $16
      i32.add
      f32.load
      local.tee $19
      f32.const 85.05113220214844
      f32.gt
      br_if $wasm/kernels/clampLat|inlined.1
      drop
      f32.const -85.05113220214844
      local.get $19
      f32.const -85.05113220214844
      f32.lt
      br_if $wasm/kernels/clampLat|inlined.1
      drop
      local.get $19
     end
     local.tee $19
     f32.neg
     local.get $19
     local.get $19
     f32.const 0
     f32.lt
     select
     f32.const 60
     f32.mul
     local.tee $20
     i32.trunc_sat_f32_s
     local.tee $16
     i32.const 5400
     i32.ge_s
     if
      i32.const 5399
      local.set $16
     end
     f32.const 0.5
     local.get $1
     local.get $16
     i32.const 2
     i32.shl
     i32.add
     local.tee $21
     f32.load
     local.tee $22
     local.get $21
     f32.load offset=4
     local.get $22
     f32.sub
     local.get $20
     local.get $16
     f32.convert_i32_s
     f32.sub
     f32.mul
     f32.add
     local.tee $20
     f32.neg
     local.get $20
     local.get $19
     f32.const 0
     f32.lt
     select
     f32.const 0.15915493667125702
     f32.mul
     f32.sub
     local.get $7
     f32.sub
     local.get $8
     f32.mul
     local.get $10
     f32.add
     local.tee $19
     local.get $12
     f32.ge
     local.get $14
     local.get $19
     f32.ge
     i32.and
     if
      local.get $4
      local.get $15
      i32.const 3
      i32.shl
      i32.add
      local.tee $16
      local.get $18
      f32.store
      local.get $16
      local.get $19
      f32.store offset=4
      local.get $5
      local.get $15
      i32.const 2
      i32.shl
      i32.add
      local.get $17
      i32.store
      local.get $15
      i32.const 1
      i32.add
      local.set $15
     end
    end
    local.get $17
    i32.const 1
    i32.add
    local.set $17
    br $for-loop|0
   end
  end
  local.get $15
 )
 (func $wasm/kernels/computeQuadraticArcsBatch (type $9)
  (param $count i32) (param $srcLatsOff i32) (param $srcLonsOff i32) (param $dstLatsOff i32) (param $dstLonsOff i32) (param $outOff i32) (result i32)
  (local $a i32) (local $i i32) (local $outCursor i32)
  (local $sLat f32) (local $sLon f32) (local $dLatVal f32) (local $dLonVal f32)
  (local $dLon f32) (local $dLat f32) (local $dist f32)
  (local $ctrlLat f32) (local $ctrlLon f32) (local $targetLon f32)
  (local $t f32) (local $invT f32) (local $invT2 f32) (local $twoInvTT f32) (local $t2 f32)
  (local $lat f32) (local $lon f32)
  (local.set $outCursor (local.get $outOff))
  (loop $arc_loop
   (if (i32.lt_s (local.get $a) (local.get $count))
    (then
     (local.set $sLat (f32.load (i32.add (local.get $srcLatsOff) (i32.shl (local.get $a) (i32.const 2)))))
     (local.set $sLon (f32.load (i32.add (local.get $srcLonsOff) (i32.shl (local.get $a) (i32.const 2)))))
     (local.set $dLatVal (f32.load (i32.add (local.get $dstLatsOff) (i32.shl (local.get $a) (i32.const 2)))))
     (local.set $dLonVal (f32.load (i32.add (local.get $dstLonsOff) (i32.shl (local.get $a) (i32.const 2)))))
     (local.set $dLon (f32.sub (local.get $dLonVal) (local.get $sLon)))
     (local.set $dLat (f32.sub (local.get $sLat) (local.get $dLatVal)))
     (local.set $dist (f32.add (f32.abs (local.get $dLat)) (f32.abs (local.get $dLon))))
     (local.set $ctrlLat
      (f32.add
       (f32.mul (f32.add (local.get $sLat) (local.get $dLatVal)) (f32.const 0.5))
       (f32.mul (local.get $dist) (f32.const 0.2))))
     (local.set $ctrlLon (f32.add (local.get $sLon) (f32.mul (local.get $dLon) (f32.const 0.5))))
     (local.set $targetLon (f32.add (local.get $sLon) (local.get $dLon)))
     (local.set $i (i32.const 0))
     (loop $step_loop
      (if (i32.le_s (local.get $i) (i32.const 18))
       (then
        (local.set $t (f32.div (f32.convert_i32_s (local.get $i)) (f32.const 18)))
        (local.set $invT (f32.sub (f32.const 1) (local.get $t)))
        (local.set $invT2 (f32.mul (local.get $invT) (local.get $invT)))
        (local.set $twoInvTT (f32.mul (f32.mul (f32.const 2) (local.get $invT)) (local.get $t)))
        (local.set $t2 (f32.mul (local.get $t) (local.get $t)))
        (local.set $lat
         (f32.add
          (f32.add (f32.mul (local.get $invT2) (local.get $sLat)) (f32.mul (local.get $twoInvTT) (local.get $ctrlLat)))
          (f32.mul (local.get $t2) (local.get $dLatVal))))
        (local.set $lon
         (f32.add
          (f32.add (f32.mul (local.get $invT2) (local.get $sLon)) (f32.mul (local.get $twoInvTT) (local.get $ctrlLon)))
          (f32.mul (local.get $t2) (local.get $targetLon))))
        (if (f32.gt (local.get $lon) (f32.const 180))
         (then (local.set $lon (f32.sub (local.get $lon) (f32.const 360))))
         (else
          (if (f32.lt (local.get $lon) (f32.const -180))
           (then (local.set $lon (f32.add (local.get $lon) (f32.const 360)))))))
        (f32.store (local.get $outCursor) (local.get $lat))
        (f32.store offset=4 (local.get $outCursor) (local.get $lon))
        (local.set $outCursor (i32.add (local.get $outCursor) (i32.const 8)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $step_loop))))
     (local.set $a (i32.add (local.get $a) (i32.const 1)))
     (br $arc_loop))))
  (i32.mul (local.get $count) (i32.const 38))
 )
 (func $wasm/kernels/decodeGeobufRingMercator (type $10)
  (param $ptCount i32) (param $dims i32) (param $lutOff i32) (param $inCoordsOff i32) (param $outXYOff i32) (param $boundsOff i32) (param $invScale f64) (param $accOff i32) (result i32)
  (local $p i32) (local $inStep i32) (local $inCur i32) (local $outCur i32)
  (local $accLon f64) (local $accLat f64)
  (local $lon f32) (local $rawLat f32) (local $clampedLat f32)
  (local $minLon f32) (local $minLat f32) (local $maxLon f32) (local $maxLat f32)
  (local $idxFull f32) (local $idx i32) (local $lutPtr i32) (local $y0 f32) (local $my f32)
  (local.set $accLon (f64.load (local.get $accOff)))
  (local.set $accLat (f64.load offset=8 (local.get $accOff)))
  (local.set $minLon (f32.load (local.get $boundsOff)))
  (local.set $minLat (f32.load offset=4 (local.get $boundsOff)))
  (local.set $maxLon (f32.load offset=8 (local.get $boundsOff)))
  (local.set $maxLat (f32.load offset=12 (local.get $boundsOff)))
  (local.set $inStep (i32.shl (local.get $dims) (i32.const 3)))
  (local.set $inCur (local.get $inCoordsOff))
  (local.set $outCur (local.get $outXYOff))
  (loop $pt_loop
   (if (i32.lt_s (local.get $p) (local.get $ptCount))
    (then
     (local.set $accLon (f64.add (local.get $accLon) (f64.load (local.get $inCur))))
     (local.set $accLat (f64.add (local.get $accLat) (f64.load offset=8 (local.get $inCur))))
     (local.set $lon (f32.demote_f64 (f64.mul (local.get $accLon) (local.get $invScale))))
     (local.set $rawLat (f32.demote_f64 (f64.mul (local.get $accLat) (local.get $invScale))))
     (if (f32.lt (local.get $lon) (local.get $minLon)) (then (local.set $minLon (local.get $lon))))
     (if (f32.lt (local.get $rawLat) (local.get $minLat)) (then (local.set $minLat (local.get $rawLat))))
     (if (f32.gt (local.get $lon) (local.get $maxLon)) (then (local.set $maxLon (local.get $lon))))
     (if (f32.gt (local.get $rawLat) (local.get $maxLat)) (then (local.set $maxLat (local.get $rawLat))))
     (local.set $clampedLat (local.get $rawLat))
     (if (f32.gt (local.get $clampedLat) (f32.const 85.05112878)) (then (local.set $clampedLat (f32.const 85.05112878))))
     (if (f32.lt (local.get $clampedLat) (f32.const -85.05112878)) (then (local.set $clampedLat (f32.const -85.05112878))))
     (local.set $idxFull (f32.mul (f32.abs (local.get $clampedLat)) (f32.const 60)))
     (if (f32.gt (local.get $idxFull) (f32.const 5400)) (then (local.set $idxFull (f32.const 5400))))
     (local.set $idx (i32.trunc_sat_f32_s (local.get $idxFull)))
     (if (i32.ge_s (local.get $idx) (i32.const 5400)) (then (local.set $idx (i32.const 5399))))
     (local.set $lutPtr (i32.add (local.get $lutOff) (i32.shl (local.get $idx) (i32.const 2))))
     (local.set $y0 (f32.load (local.get $lutPtr)))
     (local.set $my
      (f32.add
       (local.get $y0)
       (f32.mul (f32.sub (f32.load offset=4 (local.get $lutPtr)) (local.get $y0)) (f32.sub (local.get $idxFull) (f32.convert_i32_s (local.get $idx))))))
     (if (f32.lt (local.get $clampedLat) (f32.const 0)) (then (local.set $my (f32.neg (local.get $my)))))
     (f32.store (local.get $outCur) (f32.mul (f32.add (local.get $lon) (f32.const 180)) (f32.const 0.002777777777777778)))
     (f32.store offset=4 (local.get $outCur) (f32.sub (f32.const 0.5) (f32.mul (local.get $my) (f32.const 0.15915494309189535))))
     (local.set $inCur (i32.add (local.get $inCur) (local.get $inStep)))
     (local.set $outCur (i32.add (local.get $outCur) (i32.const 8)))
     (local.set $p (i32.add (local.get $p) (i32.const 1)))
     (br $pt_loop))))
  (f64.store (local.get $accOff) (local.get $accLon))
  (f64.store offset=8 (local.get $accOff) (local.get $accLat))
  (f32.store (local.get $boundsOff) (local.get $minLon))
  (f32.store offset=4 (local.get $boundsOff) (local.get $minLat))
  (f32.store offset=8 (local.get $boundsOff) (local.get $maxLon))
  (f32.store offset=12 (local.get $boundsOff) (local.get $maxLat))
  (i32.shl (local.get $ptCount) (i32.const 1))
 )
 (func $wasm/kernels/decodeLocationDictBatch (type $11)
  (param $locCount i32) (param $lutOff i32) (param $inRawOff i32) (param $latsOff i32) (param $lonsOff i32) (param $mxsOff i32) (param $mysOff i32) (result i32)
  (local $i i32) (local $inCur i32) (local $lat f32) (local $lon f32) (local $clampedLat f32)
  (local $idxFull f32) (local $idx i32) (local $lutPtr i32) (local $y0 f32) (local $my f32) (local $outOff i32)
  (local.set $inCur (local.get $inRawOff))
  (loop $loc_loop
   (if (i32.lt_s (local.get $i) (local.get $locCount))
    (then
     (local.set $lat (f32.mul (f32.convert_i32_s (i32.load16_s (local.get $inCur))) (f32.const 0.002746665852840507)))
     (local.set $lon (f32.mul (f32.convert_i32_s (i32.load16_s offset=2 (local.get $inCur))) (f32.const 0.005493331705681014)))
     (local.set $clampedLat (local.get $lat))
     (if (f32.gt (local.get $clampedLat) (f32.const 85.05112878)) (then (local.set $clampedLat (f32.const 85.05112878))))
     (if (f32.lt (local.get $clampedLat) (f32.const -85.05112878)) (then (local.set $clampedLat (f32.const -85.05112878))))
     (local.set $idxFull (f32.mul (f32.abs (local.get $clampedLat)) (f32.const 60)))
     (if (f32.gt (local.get $idxFull) (f32.const 5400)) (then (local.set $idxFull (f32.const 5400))))
     (local.set $idx (i32.trunc_sat_f32_s (local.get $idxFull)))
     (if (i32.ge_s (local.get $idx) (i32.const 5400)) (then (local.set $idx (i32.const 5399))))
     (local.set $lutPtr (i32.add (local.get $lutOff) (i32.shl (local.get $idx) (i32.const 2))))
     (local.set $y0 (f32.load (local.get $lutPtr)))
     (local.set $my
      (f32.add
       (local.get $y0)
       (f32.mul (f32.sub (f32.load offset=4 (local.get $lutPtr)) (local.get $y0)) (f32.sub (local.get $idxFull) (f32.convert_i32_s (local.get $idx))))))
     (if (f32.lt (local.get $clampedLat) (f32.const 0)) (then (local.set $my (f32.neg (local.get $my)))))
     (local.set $outOff (i32.shl (local.get $i) (i32.const 2)))
     (f32.store (i32.add (local.get $latsOff) (local.get $outOff)) (local.get $lat))
     (f32.store (i32.add (local.get $lonsOff) (local.get $outOff)) (local.get $lon))
     (f32.store (i32.add (local.get $mxsOff) (local.get $outOff)) (f32.mul (local.get $lon) (f32.const 0.017453292519943295)))
     (f32.store (i32.add (local.get $mysOff) (local.get $outOff)) (local.get $my))
     (local.set $inCur (i32.add (local.get $inCur) (i32.const 6)))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br $loc_loop))))
  (local.get $locCount)
 )
 (func $wasm/kernels/projectInterleavedMercator
  (param $ptCount i32) (param $lutOff i32) (param $inLatLonOff i32) (param $outXYOff i32) (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32) (result i32)
  (local $i i32) (local $inPtr i32) (local $outPtr i32) (local $lat f32) (local $lon f32)
  (local $clampedLat f32) (local $idxFull f32) (local $idx i32) (local $lutPtr i32)
  (local $y0 f32) (local $my f32) (local $sx f32) (local $sy f32)
  (if (i32.le_s (local.get $ptCount) (i32.const 0)) (then (return (i32.const 0))))
  (local.set $inPtr (local.get $inLatLonOff))
  (local.set $outPtr (local.get $outXYOff))
  (loop $pt_loop
   (if (i32.lt_s (local.get $i) (local.get $ptCount))
    (then
     (local.set $lat (f32.load (local.get $inPtr)))
     (local.set $lon (f32.load offset=4 (local.get $inPtr)))
     (local.set $sx
      (f32.add
       (f32.mul
        (f32.sub
         (f32.mul (f32.add (local.get $lon) (f32.const 180)) (f32.const 2.7777778450399637e-03))
         (local.get $centerNormX))
        (local.get $worldSize))
       (local.get $halfW)))
     (local.set $clampedLat (local.get $lat))
     (if (f32.gt (local.get $clampedLat) (f32.const 85.05112878)) (then (local.set $clampedLat (f32.const 85.05112878))))
     (if (f32.lt (local.get $clampedLat) (f32.const -85.05112878)) (then (local.set $clampedLat (f32.const -85.05112878))))
     (local.set $idxFull (f32.mul (f32.abs (local.get $clampedLat)) (f32.const 60)))
     (if (f32.gt (local.get $idxFull) (f32.const 5400)) (then (local.set $idxFull (f32.const 5400))))
     (local.set $idx (i32.trunc_sat_f32_s (local.get $idxFull)))
     (if (i32.ge_s (local.get $idx) (i32.const 5400)) (then (local.set $idx (i32.const 5399))))
     (local.set $lutPtr (i32.add (local.get $lutOff) (i32.shl (local.get $idx) (i32.const 2))))
     (local.set $y0 (f32.load (local.get $lutPtr)))
     (local.set $my
      (f32.add
       (local.get $y0)
       (f32.mul (f32.sub (f32.load offset=4 (local.get $lutPtr)) (local.get $y0)) (f32.sub (local.get $idxFull) (f32.convert_i32_s (local.get $idx))))))
     (if (f32.lt (local.get $clampedLat) (f32.const 0)) (then (local.set $my (f32.neg (local.get $my)))))
     (local.set $sy
      (f32.add
       (f32.mul
        (f32.sub
         (f32.sub (f32.const 0.5) (f32.mul (local.get $my) (f32.const 0.15915493667125702)))
         (local.get $centerNormY))
        (local.get $worldSize))
       (local.get $halfH)))
     (f32.store (local.get $outPtr) (local.get $sx))
     (f32.store offset=4 (local.get $outPtr) (local.get $sy))
     (local.set $inPtr (i32.add (local.get $inPtr) (i32.const 8)))
     (local.set $outPtr (i32.add (local.get $outPtr) (i32.const 8)))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br $pt_loop))))
  (local.get $ptCount)
 )
)
