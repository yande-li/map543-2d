(module
 (memory $0 8 512)
 (export "findNearestPointBatch" (func $wasm/kernels/findNearestPointBatch))
 (export "batchProjectMercator" (func $wasm/kernels/batchProjectMercator))
 (export "decimateRingsBatch" (func $wasm/kernels/decimateRingsBatch))
 (export "computeArcsBatch" (func $wasm/kernels/computeArcsBatch))
 (export "decodeGeobufRingMercator" (func $wasm/kernels/decodeGeobufRingMercator))
 (export "projectMercator" (func $wasm/kernels/projectMercator))
 (export "decimateRingsBatchU16" (func $wasm/kernels/decimateRingsBatchU16))
 (export "batchProjectMercatorI16" (func $wasm/kernels/batchProjectMercatorI16))
 (export "findNearestPointBatchI16" (func $wasm/kernels/findNearestPointBatchI16))
 (export "renderHeatmapGrid" (func $wasm/kernels/renderHeatmapGrid))
 (export "batchProjectSegments" (func $wasm/kernels/batchProjectSegments))
 (export "batchProjectSegmentsI16" (func $wasm/kernels/batchProjectSegmentsI16))
 (export "memory" (memory $0))

 (func $mercatorY (param $lat f32) (param $lutOff i32) (result f32)
  (local $idxFull f32) (local $idx i32) (local $y0 f32)
  (local.set $idx
   (i32.trunc_sat_f32_s
    (local.tee $idxFull
     (f32.min
      (f32.mul (f32.abs (local.get $lat)) (f32.const 60))
      (f32.const 5103.06787109375)))))
  (local.set $y0
   (f32.load
    (local.tee $lutOff
     (i32.add (local.get $lutOff) (i32.shl (local.get $idx) (i32.const 2))))))
  (f32.copysign
   (f32.add
    (local.get $y0)
    (f32.mul
     (f32.sub (f32.load offset=4 (local.get $lutOff)) (local.get $y0))
     (f32.sub (local.get $idxFull) (f32.convert_i32_s (local.get $idx)))))
   (local.get $lat))
 )

 (func $readVal (param $ptr i32) (param $is16 i32) (result f32)
  (if (result f32) (local.get $is16)
   (then (f32.convert_i32_s (i32.load16_s (local.get $ptr))))
   (else (f32.load (local.get $ptr))))
 )

 (func $readLat (param $ptr i32) (param $is16 i32) (result f32)
  (if (result f32) (local.get $is16)
   (then (f32.mul (f32.convert_i32_s (i32.load16_s (local.get $ptr))) (f32.const 0.002746665852839747)))
   (else (f32.load (local.get $ptr))))
 )

 (func $findNearestImpl
  (param $clickX f32) (param $clickY f32) (param $radiusSq f32) (param $count i32)
  (param $lutOff i32) (param $latsOff i32) (param $lonsOff i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (param $is16 i32)
  (result i32)
  (local $i i32) (local $bestIdx i32) (local $off i32)
  (local $lonScale f32) (local $lonBias f32) (local $yScale f32) (local $yBias f32)
  (local $dxSq f32) (local $dy f32)
  (if (i32.or (i32.le_s (local.get $count) (i32.const 0)) (f32.lt (local.get $radiusSq) (f32.const 0)))
   (then (return (i32.const -1))))
  (local.set $lonScale
   (f32.mul (local.get $worldSize)
    (select (f32.const 1.5259254723787308e-05) (f32.const 2.7777778450399637e-03) (local.get $is16))))
  (local.set $lonBias
   (f32.sub
    (f32.add
     (f32.mul (f32.sub (f32.const 0.5) (local.get $centerNormX)) (local.get $worldSize))
     (local.get $halfW))
    (local.get $clickX)))
  (local.set $yScale (f32.mul (local.get $worldSize) (f32.const -0.15915493667125702)))
  (local.set $yBias
   (f32.sub
    (f32.add
     (f32.mul (f32.sub (f32.const 0.5) (local.get $centerNormY)) (local.get $worldSize))
     (local.get $halfH))
    (local.get $clickY)))
  (local.set $bestIdx (i32.const -1))
  (loop $loop
   (if (i32.lt_s (local.get $i) (local.get $count))
    (then
     (local.set $off (i32.shl (local.get $i) (select (i32.const 1) (i32.const 2) (local.get $is16))))
     (if
      (f32.le
       (local.tee $dxSq
        (f32.mul
         (local.tee $dxSq
          (f32.add
           (f32.mul (call $readVal (i32.add (local.get $lonsOff) (local.get $off)) (local.get $is16)) (local.get $lonScale))
           (local.get $lonBias)))
         (local.get $dxSq)))
       (local.get $radiusSq))
      (then
       (if
        (f32.le
         (local.tee $dxSq
          (f32.add
           (local.get $dxSq)
           (f32.mul
            (local.tee $dy
             (f32.add
              (f32.mul
               (call $mercatorY (call $readLat (i32.add (local.get $latsOff) (local.get $off)) (local.get $is16)) (local.get $lutOff))
               (local.get $yScale))
              (local.get $yBias)))
            (local.get $dy))))
         (local.get $radiusSq))
        (then
         (local.set $bestIdx (local.get $i))
         (local.set $radiusSq (local.get $dxSq))))))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br $loop))))
  (local.get $bestIdx)
 )

 (func $wasm/kernels/findNearestPointBatch
  (param $clickX f32) (param $clickY f32) (param $radiusSq f32) (param $count i32)
  (param $lutOff i32) (param $latsOff i32) (param $lonsOff i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (result i32)
  (call $findNearestImpl
   (local.get $clickX) (local.get $clickY) (local.get $radiusSq) (local.get $count)
   (local.get $lutOff) (local.get $latsOff) (local.get $lonsOff)
   (local.get $centerNormX) (local.get $centerNormY) (local.get $worldSize) (local.get $halfW) (local.get $halfH)
   (i32.const 0))
 )

 (func $wasm/kernels/decimateRingsBatch
  (param $ringCount i32) (param $inPtr i32) (param $ringLensPtr i32) (param $outPtr i32) (param $outLensPtr i32)
  (param $scale f32) (param $offsetX f32) (param $offsetY f32) (param $pixelStep f32)
  (result i32)
  (local $normStep f32) (local $lastNx f32) (local $lastNy f32) (local $nx f32) (local $ny f32)
  (local $ringLen i32) (local $ringEndPtr i32) (local $lastPtPtr i32)
  (local $outRingFloats i32) (local $totalOutFloats i32)
  (if (i32.le_s (local.get $ringCount) (i32.const 0))
   (then (return (i32.const 0))))
  (if (f32.gt (local.get $scale) (f32.const 0))
   (then (local.set $normStep (f32.div (local.get $pixelStep) (local.get $scale)))))
  (local.set $ringCount (i32.add (local.get $ringLensPtr) (i32.shl (local.get $ringCount) (i32.const 2))))
  (loop $ring_loop
   (if (i32.lt_u (local.get $ringLensPtr) (local.get $ringCount))
    (then
     (if (i32.lt_s (local.tee $ringLen (i32.load (local.get $ringLensPtr))) (i32.const 2))
      (then
       (i32.store (local.get $outLensPtr) (i32.const 0))
       (if (i32.gt_s (local.get $ringLen) (i32.const 0))
        (then (local.set $inPtr (i32.add (local.get $inPtr) (i32.shl (local.get $ringLen) (i32.const 2)))))))
      (else
       (local.set $lastPtPtr
        (i32.sub
         (local.tee $ringEndPtr (i32.add (local.get $inPtr) (i32.shl (local.get $ringLen) (i32.const 2))))
         (i32.const 8)))
       (f32.store
        (local.get $outPtr)
        (f32.sub (f32.mul (local.tee $lastNx (f32.load (local.get $inPtr))) (local.get $scale)) (local.get $offsetX)))
       (f32.store offset=4
        (local.get $outPtr)
        (f32.sub (f32.mul (local.tee $lastNy (f32.load offset=4 (local.get $inPtr))) (local.get $scale)) (local.get $offsetY)))
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
             (f32.ge (f32.abs (f32.sub (local.get $nx) (local.get $lastNx))) (local.get $normStep))
             (f32.ge (f32.abs (f32.sub (local.get $ny) (local.get $lastNy))) (local.get $normStep))))
           (then
            (f32.store (local.get $outPtr) (f32.sub (f32.mul (local.get $nx) (local.get $scale)) (local.get $offsetX)))
            (f32.store offset=4 (local.get $outPtr) (f32.sub (f32.mul (local.get $ny) (local.get $scale)) (local.get $offsetY)))
            (local.set $outPtr (i32.add (local.get $outPtr) (i32.const 8)))
            (local.set $outRingFloats (i32.add (local.get $outRingFloats) (i32.const 2)))
            (local.set $lastNx (local.get $nx))
            (local.set $lastNy (local.get $ny))))
          (local.set $inPtr (i32.add (local.get $inPtr) (i32.const 8)))
          (br $pt_loop))))
       (i32.store (local.get $outLensPtr) (local.get $outRingFloats))
       (local.set $totalOutFloats (i32.add (local.get $totalOutFloats) (local.get $outRingFloats)))
       (local.set $inPtr (local.get $ringEndPtr))))
     (local.set $ringLensPtr (i32.add (local.get $ringLensPtr) (i32.const 4)))
     (local.set $outLensPtr (i32.add (local.get $outLensPtr) (i32.const 4)))
     (br $ring_loop))))
  (local.get $totalOutFloats)
 )

 (func $batchProjectImpl
  (param $count i32) (param $lutOff i32) (param $latsOff i32) (param $lonsOff i32)
  (param $outXYPtr i32) (param $outIdxPtr i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (param $minX f32) (param $minY f32) (param $maxX f32) (param $maxY f32)
  (param $is16 i32)
  (result i32)
  (local $visible i32) (local $i i32) (local $off i32)
  (local $lonScale f32) (local $lonBias f32) (local $yScale f32) (local $yBias f32)
  (local $sx f32) (local $sy f32)
  (if (i32.le_s (local.get $count) (i32.const 0))
   (then (return (i32.const 0))))
  (local.set $lonScale
   (f32.mul (local.get $worldSize)
    (select (f32.const 1.5259254723787308e-05) (f32.const 2.7777778450399637e-03) (local.get $is16))))
  (local.set $lonBias
   (f32.add
    (f32.mul (f32.sub (f32.const 0.5) (local.get $centerNormX)) (local.get $worldSize))
    (local.get $halfW)))
  (local.set $yScale (f32.mul (local.get $worldSize) (f32.const -0.15915493667125702)))
  (local.set $yBias
   (f32.add
    (f32.mul (f32.sub (f32.const 0.5) (local.get $centerNormY)) (local.get $worldSize))
    (local.get $halfH)))
  (loop $loop
   (if (i32.lt_s (local.get $i) (local.get $count))
    (then
     (local.set $off (i32.shl (local.get $i) (select (i32.const 1) (i32.const 2) (local.get $is16))))
     (if
      (i32.and
       (f32.ge
        (local.tee $sx
         (f32.add
          (f32.mul (call $readVal (i32.add (local.get $lonsOff) (local.get $off)) (local.get $is16)) (local.get $lonScale))
          (local.get $lonBias)))
        (local.get $minX))
       (f32.le (local.get $sx) (local.get $maxX)))
      (then
       (if
        (i32.and
         (f32.ge
          (local.tee $sy
           (f32.add
            (f32.mul
             (call $mercatorY (call $readLat (i32.add (local.get $latsOff) (local.get $off)) (local.get $is16)) (local.get $lutOff))
             (local.get $yScale))
            (local.get $yBias)))
          (local.get $minY))
         (f32.le (local.get $sy) (local.get $maxY)))
        (then
         (f32.store (local.get $outXYPtr) (local.get $sx))
         (f32.store offset=4 (local.get $outXYPtr) (local.get $sy))
         (local.set $outXYPtr (i32.add (local.get $outXYPtr) (i32.const 8)))
         (i32.store (local.get $outIdxPtr) (local.get $i))
         (local.set $outIdxPtr (i32.add (local.get $outIdxPtr) (i32.const 4)))
         (local.set $visible (i32.add (local.get $visible) (i32.const 1)))))))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br $loop))))
  (local.get $visible)
 )

 (func $wasm/kernels/batchProjectMercator
  (param $count i32) (param $lutOff i32) (param $latsOff i32) (param $lonsOff i32)
  (param $outXYPtr i32) (param $outIdxPtr i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (param $minX f32) (param $minY f32) (param $maxX f32) (param $maxY f32)
  (result i32)
  (call $batchProjectImpl
   (local.get $count) (local.get $lutOff) (local.get $latsOff) (local.get $lonsOff)
   (local.get $outXYPtr) (local.get $outIdxPtr)
   (local.get $centerNormX) (local.get $centerNormY) (local.get $worldSize) (local.get $halfW) (local.get $halfH)
   (local.get $minX) (local.get $minY) (local.get $maxX) (local.get $maxY)
   (i32.const 0))
 )

 (func $wasm/kernels/computeArcsBatch
  (param $count i32) (param $srcLatsOff i32) (param $srcLonsOff i32) (param $dstLatsOff i32) (param $dstLonsOff i32) (param $outCursor i32)
  (result i32)
  (local $i i32) (local $off i32) (local $endOff i32)
  (local $sLat f32) (local $sLon f32) (local $dLatVal f32) (local $dLon f32)
  (local $aLat f32) (local $bLat f32)
  (local $t f32) (local $lon f32)
  (local.set $endOff (i32.shl (local.get $count) (i32.const 2)))
  (loop $arc_loop
   (if (i32.lt_s (local.get $off) (local.get $endOff))
    (then
     (local.set $sLat (f32.load (i32.add (local.get $srcLatsOff) (local.get $off))))
     (local.set $sLon (f32.load (i32.add (local.get $srcLonsOff) (local.get $off))))
     (local.set $dLatVal (f32.load (i32.add (local.get $dstLatsOff) (local.get $off))))
     (local.set $dLon (f32.sub (f32.load (i32.add (local.get $dstLonsOff) (local.get $off))) (local.get $sLon)))
     (local.set $aLat
      (f32.mul
       (f32.add
        (f32.abs (f32.sub (local.get $sLat) (local.get $dLatVal)))
        (f32.abs (local.get $dLon)))
       (f32.const -0.4)))
     (local.set $bLat (f32.sub (f32.sub (local.get $dLatVal) (local.get $sLat)) (local.get $aLat)))
     (local.set $i (i32.const 0))
     (loop $step_loop
      (if (i32.le_s (local.get $i) (i32.const 18))
       (then
        (local.set $t (f32.mul (f32.convert_i32_s (local.get $i)) (f32.const 0.0555555559694767)))
        (f32.store
         (local.get $outCursor)
         (f32.add
          (f32.mul (f32.add (f32.mul (local.get $aLat) (local.get $t)) (local.get $bLat)) (local.get $t))
          (local.get $sLat)))
        (local.set $lon (f32.add (local.get $sLon) (f32.mul (local.get $dLon) (local.get $t))))
        (if (f32.gt (local.get $lon) (f32.const 180))
         (then (local.set $lon (f32.sub (local.get $lon) (f32.const 360))))
         (else
          (if (f32.lt (local.get $lon) (f32.const -180))
           (then (local.set $lon (f32.add (local.get $lon) (f32.const 360)))))))
        (f32.store offset=4 (local.get $outCursor) (local.get $lon))
        (local.set $outCursor (i32.add (local.get $outCursor) (i32.const 8)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $step_loop))))
     (local.set $off (i32.add (local.get $off) (i32.const 4)))
     (br $arc_loop))))
  (i32.mul (local.get $count) (i32.const 38))
 )

 (func $wasm/kernels/decodeGeobufRingMercator
  (param $ptCount i32) (param $dims i32) (param $lutOff i32) (param $inCur i32) (param $outCur i32)
  (param $boundsOff i32) (param $invScale f64) (param $accOff i32)
  (result i32)
  (local $outEnd i32)
  (local $accLon f64) (local $accLat f64)
  (local $lon f32) (local $rawLat f32)
  (local $minLon f32) (local $minLat f32) (local $maxLon f32) (local $maxLat f32)
  (local.set $accLon (f64.load (local.get $accOff)))
  (local.set $accLat (f64.load offset=8 (local.get $accOff)))
  (local.set $minLon (f32.load (local.get $boundsOff)))
  (local.set $minLat (f32.load offset=4 (local.get $boundsOff)))
  (local.set $maxLon (f32.load offset=8 (local.get $boundsOff)))
  (local.set $maxLat (f32.load offset=12 (local.get $boundsOff)))
  (local.set $dims (i32.shl (local.get $dims) (i32.const 3)))
  (local.set $outEnd (i32.add (local.get $outCur) (i32.shl (local.get $ptCount) (i32.const 3))))
  (loop $pt_loop
   (if (i32.lt_u (local.get $outCur) (local.get $outEnd))
    (then
     (local.set $lon
      (f32.demote_f64
       (f64.mul
        (local.tee $accLon (f64.add (local.get $accLon) (f64.load (local.get $inCur))))
        (local.get $invScale))))
     (local.set $rawLat
      (f32.demote_f64
       (f64.mul
        (local.tee $accLat (f64.add (local.get $accLat) (f64.load offset=8 (local.get $inCur))))
        (local.get $invScale))))
     (if (f32.lt (local.get $lon) (local.get $minLon)) (then (local.set $minLon (local.get $lon))))
     (if (f32.lt (local.get $rawLat) (local.get $minLat)) (then (local.set $minLat (local.get $rawLat))))
     (if (f32.gt (local.get $lon) (local.get $maxLon)) (then (local.set $maxLon (local.get $lon))))
     (if (f32.gt (local.get $rawLat) (local.get $maxLat)) (then (local.set $maxLat (local.get $rawLat))))
     (f32.store
      (local.get $outCur)
      (f32.mul (f32.add (local.get $lon) (f32.const 180)) (f32.const 0.002777777777777778)))
     (f32.store offset=4
      (local.get $outCur)
      (f32.sub
       (f32.const 0.5)
       (f32.mul (call $mercatorY (local.get $rawLat) (local.get $lutOff)) (f32.const 0.15915494309189535))))
     (local.set $inCur (i32.add (local.get $inCur) (local.get $dims)))
     (local.set $outCur (i32.add (local.get $outCur) (i32.const 8)))
     (br $pt_loop))))
  (f64.store (local.get $accOff) (local.get $accLon))
  (f64.store offset=8 (local.get $accOff) (local.get $accLat))
  (f32.store (local.get $boundsOff) (local.get $minLon))
  (f32.store offset=4 (local.get $boundsOff) (local.get $minLat))
  (f32.store offset=8 (local.get $boundsOff) (local.get $maxLon))
  (f32.store offset=12 (local.get $boundsOff) (local.get $maxLat))
  (i32.shl (local.get $ptCount) (i32.const 1))
 )

 (func $wasm/kernels/projectMercator
  (param $ptCount i32) (param $lutOff i32) (param $inPtr i32) (param $outPtr i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (result i32)
  (local $outEnd i32) (local $lonScale f32) (local $lonBias f32) (local $yScale f32) (local $yBias f32)
  (if (i32.le_s (local.get $ptCount) (i32.const 0)) (then (return (i32.const 0))))
  (local.set $lonScale (f32.mul (local.get $worldSize) (f32.const 2.7777778450399637e-03)))
  (local.set $lonBias
   (f32.add
    (f32.mul (f32.sub (f32.const 0.5) (local.get $centerNormX)) (local.get $worldSize))
    (local.get $halfW)))
  (local.set $yScale (f32.mul (local.get $worldSize) (f32.const -0.15915493667125702)))
  (local.set $yBias
   (f32.add
    (f32.mul (f32.sub (f32.const 0.5) (local.get $centerNormY)) (local.get $worldSize))
    (local.get $halfH)))
  (local.set $outEnd (i32.add (local.get $outPtr) (i32.shl (local.get $ptCount) (i32.const 3))))
  (loop $pt_loop
   (if (i32.lt_u (local.get $outPtr) (local.get $outEnd))
    (then
     (f32.store
      (local.get $outPtr)
      (f32.add
       (f32.mul (f32.load offset=4 (local.get $inPtr)) (local.get $lonScale))
       (local.get $lonBias)))
     (f32.store offset=4
      (local.get $outPtr)
      (f32.add
       (f32.mul (call $mercatorY (f32.load (local.get $inPtr)) (local.get $lutOff)) (local.get $yScale))
       (local.get $yBias)))
     (local.set $inPtr (i32.add (local.get $inPtr) (i32.const 8)))
     (local.set $outPtr (i32.add (local.get $outPtr) (i32.const 8)))
     (br $pt_loop))))
  (local.get $ptCount)
 )

 (func $wasm/kernels/decimateRingsBatchU16
  (param $ringCount i32) (param $inPtr i32) (param $ringLensPtr i32) (param $outPtr i32) (param $outLensPtr i32)
  (param $scale f32) (param $offsetX f32) (param $offsetY f32) (param $pixelStep f32)
  (result i32)
  (local $normStepU16 i32) (local $scaleNorm f32)
  (local $lastNx i32) (local $lastNy i32) (local $nx i32) (local $ny i32) (local $dx i32) (local $dy i32)
  (local $ringLen i32) (local $ringEndPtr i32) (local $lastPtPtr i32)
  (local $outRingFloats i32) (local $totalOutFloats i32)
  (if (i32.le_s (local.get $ringCount) (i32.const 0))
   (then (return (i32.const 0))))
  (if (f32.gt (local.get $scale) (f32.const 0))
   (then
    (local.set $normStepU16
     (i32.trunc_sat_f32_s (f32.div (f32.mul (local.get $pixelStep) (f32.const 65535)) (local.get $scale))))))
  (local.set $scaleNorm (f32.div (local.get $scale) (f32.const 65535)))
  (local.set $ringCount (i32.add (local.get $ringLensPtr) (i32.shl (local.get $ringCount) (i32.const 2))))
  (loop $ring_loop
   (if (i32.lt_u (local.get $ringLensPtr) (local.get $ringCount))
    (then
     (if (i32.lt_s (local.tee $ringLen (i32.load (local.get $ringLensPtr))) (i32.const 2))
      (then
       (i32.store (local.get $outLensPtr) (i32.const 0))
       (if (i32.gt_s (local.get $ringLen) (i32.const 0))
        (then (local.set $inPtr (i32.add (local.get $inPtr) (i32.shl (local.get $ringLen) (i32.const 1)))))))
      (else
       (local.set $lastPtPtr
        (i32.sub
         (local.tee $ringEndPtr (i32.add (local.get $inPtr) (i32.shl (local.get $ringLen) (i32.const 1))))
         (i32.const 4)))
       (f32.store
        (local.get $outPtr)
        (f32.sub (f32.mul (f32.convert_i32_u (local.tee $lastNx (i32.load16_u (local.get $inPtr)))) (local.get $scaleNorm)) (local.get $offsetX)))
       (f32.store offset=4
        (local.get $outPtr)
        (f32.sub (f32.mul (f32.convert_i32_u (local.tee $lastNy (i32.load16_u offset=2 (local.get $inPtr)))) (local.get $scaleNorm)) (local.get $offsetY)))
       (local.set $outPtr (i32.add (local.get $outPtr) (i32.const 8)))
       (local.set $outRingFloats (i32.const 2))
       (local.set $inPtr (i32.add (local.get $inPtr) (i32.const 4)))
       (loop $pt_loop
        (if (i32.lt_u (local.get $inPtr) (local.get $ringEndPtr))
         (then
          (local.set $nx (i32.load16_u (local.get $inPtr)))
          (local.set $ny (i32.load16_u offset=2 (local.get $inPtr)))
          (local.set $dx (i32.sub (local.get $nx) (local.get $lastNx)))
          (local.set $dy (i32.sub (local.get $ny) (local.get $lastNy)))
          (if
           (i32.or
            (i32.eq (local.get $inPtr) (local.get $lastPtPtr))
            (i32.or
             (i32.ge_s
              (select (local.get $dx) (i32.sub (i32.const 0) (local.get $dx)) (i32.ge_s (local.get $dx) (i32.const 0)))
              (local.get $normStepU16))
             (i32.ge_s
              (select (local.get $dy) (i32.sub (i32.const 0) (local.get $dy)) (i32.ge_s (local.get $dy) (i32.const 0)))
              (local.get $normStepU16))))
           (then
            (f32.store (local.get $outPtr) (f32.sub (f32.mul (f32.convert_i32_u (local.get $nx)) (local.get $scaleNorm)) (local.get $offsetX)))
            (f32.store offset=4 (local.get $outPtr) (f32.sub (f32.mul (f32.convert_i32_u (local.get $ny)) (local.get $scaleNorm)) (local.get $offsetY)))
            (local.set $outPtr (i32.add (local.get $outPtr) (i32.const 8)))
            (local.set $outRingFloats (i32.add (local.get $outRingFloats) (i32.const 2)))
            (local.set $lastNx (local.get $nx))
            (local.set $lastNy (local.get $ny))))
          (local.set $inPtr (i32.add (local.get $inPtr) (i32.const 4)))
          (br $pt_loop))))
       (i32.store (local.get $outLensPtr) (local.get $outRingFloats))
       (local.set $totalOutFloats (i32.add (local.get $totalOutFloats) (local.get $outRingFloats)))
       (local.set $inPtr (local.get $ringEndPtr))))
     (local.set $ringLensPtr (i32.add (local.get $ringLensPtr) (i32.const 4)))
     (local.set $outLensPtr (i32.add (local.get $outLensPtr) (i32.const 4)))
     (br $ring_loop))))
  (local.get $totalOutFloats)
 )

 (func $wasm/kernels/batchProjectMercatorI16
  (param $count i32) (param $lutOff i32) (param $latsOff i32) (param $lonsOff i32)
  (param $outXYPtr i32) (param $outIdxPtr i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (param $minX f32) (param $minY f32) (param $maxX f32) (param $maxY f32)
  (result i32)
  (call $batchProjectImpl
   (local.get $count) (local.get $lutOff) (local.get $latsOff) (local.get $lonsOff)
   (local.get $outXYPtr) (local.get $outIdxPtr)
   (local.get $centerNormX) (local.get $centerNormY) (local.get $worldSize) (local.get $halfW) (local.get $halfH)
   (local.get $minX) (local.get $minY) (local.get $maxX) (local.get $maxY)
   (i32.const 1))
 )

 (func $wasm/kernels/findNearestPointBatchI16
  (param $clickX f32) (param $clickY f32) (param $radiusSq f32) (param $count i32)
  (param $lutOff i32) (param $latsOff i32) (param $lonsOff i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (result i32)
  (call $findNearestImpl
   (local.get $clickX) (local.get $clickY) (local.get $radiusSq) (local.get $count)
   (local.get $lutOff) (local.get $latsOff) (local.get $lonsOff)
   (local.get $centerNormX) (local.get $centerNormY) (local.get $worldSize) (local.get $halfW) (local.get $halfH)
   (i32.const 1))
 )

 (func $addCell (param $buf i32) (param $w i32) (param $h i32) (param $x i32) (param $y i32) (param $v f32)
  (local $addr i32)
  (if
   (i32.and
    (i32.and (i32.ge_s (local.get $x) (i32.const 0)) (i32.lt_s (local.get $x) (local.get $w)))
    (i32.and (i32.ge_s (local.get $y) (i32.const 0)) (i32.lt_s (local.get $y) (local.get $h))))
   (then
    (local.set $addr (i32.add (local.get $buf) (i32.shl (i32.add (i32.mul (local.get $y) (local.get $w)) (local.get $x)) (i32.const 2))))
    (f32.store (local.get $addr) (f32.add (f32.load (local.get $addr)) (local.get $v)))))
 )

 (func $zeroF32 (param $buf i32) (param $n i32)
  (local $i i32)
  (loop $z
   (if (i32.lt_s (local.get $i) (local.get $n))
    (then
     (f32.store (i32.add (local.get $buf) (i32.shl (local.get $i) (i32.const 2))) (f32.const 0))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br $z))))
 )

 (func $blur1D (param $src i32) (param $dst i32) (param $w i32) (param $h i32) (param $rInt i32) (param $kLut i32) (param $isVert i32)
  (local $x i32) (local $y i32) (local $i i32) (local $dx i32) (local $dy i32) (local $val f32) (local $t f32)
  (call $zeroF32 (local.get $dst) (i32.mul (local.get $w) (local.get $h)))
  (loop $ly
   (if (i32.lt_s (local.get $y) (local.get $h))
    (then
     (local.set $x (i32.const 0))
     (loop $lx
      (if (i32.lt_s (local.get $x) (local.get $w))
       (then
        (local.set $val (f32.load (i32.add (local.get $src) (i32.shl (i32.add (i32.mul (local.get $y) (local.get $w)) (local.get $x)) (i32.const 2)))))
        (if (f32.gt (local.get $val) (f32.const 0))
         (then
          (call $addCell (local.get $dst) (local.get $w) (local.get $h) (local.get $x) (local.get $y) (local.get $val))
          (local.set $i (i32.const 1))
          (loop $ld
           (if (i32.le_s (local.get $i) (local.get $rInt))
            (then
             (local.set $t (f32.mul (local.get $val) (f32.load (i32.add (local.get $kLut) (i32.shl (local.get $i) (i32.const 2))))))
             (local.set $dx (select (i32.const 0) (local.get $i) (local.get $isVert)))
             (local.set $dy (select (local.get $i) (i32.const 0) (local.get $isVert)))
             (call $addCell (local.get $dst) (local.get $w) (local.get $h) (i32.sub (local.get $x) (local.get $dx)) (i32.sub (local.get $y) (local.get $dy)) (local.get $t))
             (call $addCell (local.get $dst) (local.get $w) (local.get $h) (i32.add (local.get $x) (local.get $dx)) (i32.add (local.get $y) (local.get $dy)) (local.get $t))
             (local.set $i (i32.add (local.get $i) (i32.const 1)))
             (br $ld))))))
        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br $lx))))
     (local.set $y (i32.add (local.get $y) (i32.const 1)))
     (br $ly))))
 )

 (func $wasm/kernels/renderHeatmapGrid
  (param $ptCount i32) (param $xyOff i32) (param $weightsOff i32)
  (param $gridW i32) (param $gridH i32)
  (param $scaleX f32) (param $scaleY f32)
  (param $radiusGrid f32) (param $invMaxIntensity f32)
  (param $intensityMode i32) (param $kernelLutOff i32)
  (param $densityOff i32) (param $lutOff i32) (param $outRgbaOff i32)
  (result i32)
  (local $cells i32) (local $i i32) (local $p i32) (local $rInt i32) (local $isSep i32)
  (local $sx f32) (local $sy f32) (local $w f32)
  (local $gx f32) (local $gy f32) (local $invRSq f32)
  (local $x0 i32) (local $y0 i32) (local $x1 i32) (local $y1 i32)
  (local $x i32) (local $y i32) (local $dx f32) (local $dy f32)
  (local $dSq f32) (local $t f32) (local $maxD f32) (local $addr i32)
  (if
   (i32.or
    (i32.or (i32.lt_s (local.get $ptCount) (i32.const 0)) (i32.le_s (local.get $gridW) (i32.const 0)))
    (i32.or (i32.le_s (local.get $gridH) (i32.const 0)) (i32.eqz (f32.gt (local.get $radiusGrid) (f32.const 0)))))
   (then (return (i32.const 0))))
  (if
   (i32.or
    (i32.or (i32.gt_s (local.get $gridW) (i32.const 4096)) (i32.gt_s (local.get $gridH) (i32.const 4096)))
    (f32.gt (local.get $radiusGrid) (f32.const 128)))
   (then (return (i32.const 0))))
  (if
   (i32.or
    (i32.or (i32.eqz (f32.gt (local.get $scaleX) (f32.const 0))) (i32.eqz (f32.gt (local.get $scaleY) (f32.const 0))))
    (f32.lt (local.get $invMaxIntensity) (f32.const 0)))
   (then (return (i32.const 0))))
  (local.set $rInt (i32.trunc_sat_f32_s (f32.ceil (local.get $radiusGrid))))
  (if (i32.lt_s (local.get $rInt) (i32.const 1)) (then (local.set $rInt (i32.const 1))))
  (local.set $cells (i32.mul (local.get $gridW) (local.get $gridH)))
  (local.set $isSep (i32.and (local.get $intensityMode) (i32.const 2)))
  (local.set $invRSq (f32.div (f32.const 1) (f32.mul (local.get $radiusGrid) (local.get $radiusGrid))))
  (call $zeroF32 (local.get $densityOff) (local.get $cells))
  (loop $pt_loop
   (if (i32.lt_s (local.get $p) (local.get $ptCount))
    (then
     (local.set $addr (i32.add (local.get $xyOff) (i32.shl (local.get $p) (i32.const 3))))
     (local.set $sx (f32.load (local.get $addr)))
     (local.set $sy (f32.load offset=4 (local.get $addr)))
     (local.set $w
      (if (result f32) (local.get $weightsOff)
       (then (f32.load (i32.add (local.get $weightsOff) (i32.shl (local.get $p) (i32.const 2)))))
       (else (f32.const 1))))
     (if
      (i32.and
       (i32.and (f32.eq (local.get $sx) (local.get $sx)) (f32.eq (local.get $sy) (local.get $sy)))
       (f32.gt (local.get $w) (f32.const 0)))
      (then
       (local.set $gx (f32.mul (local.get $sx) (local.get $scaleX)))
       (local.set $gy (f32.mul (local.get $sy) (local.get $scaleY)))
       (if (local.get $isSep)
        (then
         (local.set $gx (f32.sub (local.get $gx) (f32.const 0.5)))
         (local.set $gy (f32.sub (local.get $gy) (f32.const 0.5)))
         (local.set $x0 (i32.trunc_sat_f32_s (f32.floor (local.get $gx))))
         (local.set $y0 (i32.trunc_sat_f32_s (f32.floor (local.get $gy))))
         (local.set $dx (f32.sub (local.get $gx) (f32.convert_i32_s (local.get $x0))))
         (local.set $dy (f32.sub (local.get $gy) (f32.convert_i32_s (local.get $y0))))
         (local.set $t (f32.sub (f32.const 1) (local.get $dx)))
         (local.set $dSq (f32.sub (f32.const 1) (local.get $dy)))
         (call $addCell (local.get $densityOff) (local.get $gridW) (local.get $gridH) (local.get $x0) (local.get $y0) (f32.mul (local.get $w) (f32.mul (local.get $t) (local.get $dSq))))
         (call $addCell (local.get $densityOff) (local.get $gridW) (local.get $gridH) (i32.add (local.get $x0) (i32.const 1)) (local.get $y0) (f32.mul (local.get $w) (f32.mul (local.get $dx) (local.get $dSq))))
         (call $addCell (local.get $densityOff) (local.get $gridW) (local.get $gridH) (local.get $x0) (i32.add (local.get $y0) (i32.const 1)) (f32.mul (local.get $w) (f32.mul (local.get $t) (local.get $dy))))
         (call $addCell (local.get $densityOff) (local.get $gridW) (local.get $gridH) (i32.add (local.get $x0) (i32.const 1)) (i32.add (local.get $y0) (i32.const 1)) (f32.mul (local.get $w) (f32.mul (local.get $dx) (local.get $dy)))))
        (else
         (local.set $x0 (i32.sub (i32.trunc_sat_f32_s (local.get $gx)) (local.get $rInt)))
         (if (i32.lt_s (local.get $x0) (i32.const 0)) (then (local.set $x0 (i32.const 0))))
         (local.set $x1 (i32.add (i32.trunc_sat_f32_s (local.get $gx)) (local.get $rInt)))
         (if (i32.ge_s (local.get $x1) (local.get $gridW)) (then (local.set $x1 (i32.sub (local.get $gridW) (i32.const 1)))))
         (local.set $y0 (i32.sub (i32.trunc_sat_f32_s (local.get $gy)) (local.get $rInt)))
         (if (i32.lt_s (local.get $y0) (i32.const 0)) (then (local.set $y0 (i32.const 0))))
         (local.set $y1 (i32.add (i32.trunc_sat_f32_s (local.get $gy)) (local.get $rInt)))
         (if (i32.ge_s (local.get $y1) (local.get $gridH)) (then (local.set $y1 (i32.sub (local.get $gridH) (i32.const 1)))))
         (local.set $y (local.get $y0))
         (loop $y_loop
          (if (i32.le_s (local.get $y) (local.get $y1))
           (then
            (local.set $dy (f32.sub (f32.add (f32.convert_i32_s (local.get $y)) (f32.const 0.5)) (local.get $gy)))
            (local.set $x (local.get $x0))
            (loop $x_loop
             (if (i32.le_s (local.get $x) (local.get $x1))
              (then
               (local.set $dx (f32.sub (f32.add (f32.convert_i32_s (local.get $x)) (f32.const 0.5)) (local.get $gx)))
               (local.set $dSq
                (f32.mul
                 (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dy) (local.get $dy)))
                 (local.get $invRSq)))
               (if (f32.lt (local.get $dSq) (f32.const 1))
                (then
                 (local.set $t
                  (f32.load
                   (i32.add (local.get $kernelLutOff)
                    (i32.shl (i32.trunc_sat_f32_s (f32.mul (local.get $dSq) (f32.const 127))) (i32.const 2)))))
                 (local.set $addr
                  (i32.add (local.get $densityOff)
                   (i32.shl (i32.add (i32.mul (local.get $y) (local.get $gridW)) (local.get $x)) (i32.const 2))))
                 (f32.store (local.get $addr)
                  (f32.add (f32.load (local.get $addr)) (f32.mul (local.get $t) (local.get $w))))))
               (local.set $x (i32.add (local.get $x) (i32.const 1)))
               (br $x_loop))))
            (local.set $y (i32.add (local.get $y) (i32.const 1)))
            (br $y_loop))))))))
     (local.set $p (i32.add (local.get $p) (i32.const 1)))
     (br $pt_loop))))
  (if (local.get $isSep)
   (then
    (call $blur1D (local.get $densityOff) (local.get $outRgbaOff) (local.get $gridW) (local.get $gridH) (local.get $rInt) (local.get $kernelLutOff) (i32.const 0))
    (call $blur1D (local.get $outRgbaOff) (local.get $densityOff) (local.get $gridW) (local.get $gridH) (local.get $rInt) (local.get $kernelLutOff) (i32.const 1))))
  (if (f32.eq (local.get $invMaxIntensity) (f32.const 0))
   (then
    (local.set $maxD (f32.const 3))
    (local.set $i (i32.const 0))
    (loop $max_loop
     (if (i32.lt_s (local.get $i) (local.get $cells))
      (then
       (local.set $t (f32.load (i32.add (local.get $densityOff) (i32.shl (local.get $i) (i32.const 2)))))
       (if (f32.gt (local.get $t) (local.get $maxD)) (then (local.set $maxD (local.get $t))))
       (local.set $i (i32.add (local.get $i) (i32.const 1)))
       (br $max_loop))))
    (local.set $invMaxIntensity (f32.div (f32.const 1) (local.get $maxD)))))
  (local.set $i (i32.const 0))
  (loop $color_loop
   (if (i32.lt_s (local.get $i) (local.get $cells))
    (then
     (local.set $t
      (f32.min (f32.const 1)
       (f32.max (f32.const 0)
        (f32.mul (f32.load (i32.add (local.get $densityOff) (i32.shl (local.get $i) (i32.const 2)))) (local.get $invMaxIntensity)))))
     (if (i32.and (local.get $intensityMode) (i32.const 1))
      (then (local.set $t (f32.sqrt (local.get $t)))))
     (i32.store
      (i32.add (local.get $outRgbaOff) (i32.shl (local.get $i) (i32.const 2)))
      (i32.load (i32.add (local.get $lutOff) (i32.shl (i32.trunc_sat_f32_s (f32.add (f32.mul (local.get $t) (f32.const 255)) (f32.const 0.5))) (i32.const 2)))))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br $color_loop))))
  (local.get $cells)
 )

 (func $batchProjectSegmentsImpl
  (param $count i32) (param $lutOff i32)
  (param $srcLatsOff i32) (param $srcLonsOff i32) (param $dstLatsOff i32) (param $dstLonsOff i32)
  (param $outSegsPtr i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (param $minX f32) (param $minY f32) (param $maxX f32) (param $maxY f32)
  (param $is16 i32)
  (result i32)
  (local $visible i32) (local $i i32) (local $off i32)
  (local $lonScale f32) (local $lonBias f32) (local $yScale f32) (local $yBias f32)
  (local $sx f32) (local $sy f32) (local $dx f32) (local $dy f32)
  (if (i32.le_s (local.get $count) (i32.const 0)) (then (return (i32.const 0))))
  (local.set $lonScale
   (f32.mul (local.get $worldSize)
    (select (f32.const 1.5259254723787308e-05) (f32.const 2.7777778450399637e-03) (local.get $is16))))
  (local.set $lonBias (f32.add (f32.mul (f32.sub (f32.const 0.5) (local.get $centerNormX)) (local.get $worldSize)) (local.get $halfW)))
  (local.set $yScale (f32.mul (local.get $worldSize) (f32.const -0.15915493667125702)))
  (local.set $yBias (f32.add (f32.mul (f32.sub (f32.const 0.5) (local.get $centerNormY)) (local.get $worldSize)) (local.get $halfH)))
  (loop $seg_loop
   (if (i32.lt_s (local.get $i) (local.get $count))
    (then
     (local.set $off (i32.shl (local.get $i) (select (i32.const 1) (i32.const 2) (local.get $is16))))
     (local.set $sx (f32.add (f32.mul (call $readVal (i32.add (local.get $srcLonsOff) (local.get $off)) (local.get $is16)) (local.get $lonScale)) (local.get $lonBias)))
     (local.set $dx (f32.add (f32.mul (call $readVal (i32.add (local.get $dstLonsOff) (local.get $off)) (local.get $is16)) (local.get $lonScale)) (local.get $lonBias)))
     (if
      (i32.and
       (f32.ge (f32.max (local.get $sx) (local.get $dx)) (local.get $minX))
       (f32.le (f32.min (local.get $sx) (local.get $dx)) (local.get $maxX)))
      (then
       (local.set $sy (f32.add (f32.mul (call $mercatorY (call $readLat (i32.add (local.get $srcLatsOff) (local.get $off)) (local.get $is16)) (local.get $lutOff)) (local.get $yScale)) (local.get $yBias)))
       (local.set $dy (f32.add (f32.mul (call $mercatorY (call $readLat (i32.add (local.get $dstLatsOff) (local.get $off)) (local.get $is16)) (local.get $lutOff)) (local.get $yScale)) (local.get $yBias)))
       (if
        (i32.and
         (f32.ge (f32.max (local.get $sy) (local.get $dy)) (local.get $minY))
         (f32.le (f32.min (local.get $sy) (local.get $dy)) (local.get $maxY)))
        (then
         (f32.store (local.get $outSegsPtr) (local.get $sx))
         (f32.store offset=4 (local.get $outSegsPtr) (local.get $sy))
         (f32.store offset=8 (local.get $outSegsPtr) (local.get $dx))
         (f32.store offset=12 (local.get $outSegsPtr) (local.get $dy))
         (local.set $outSegsPtr (i32.add (local.get $outSegsPtr) (i32.const 16)))
         (local.set $visible (i32.add (local.get $visible) (i32.const 1)))))))
     (local.set $i (i32.add (local.get $i) (i32.const 1)))
     (br $seg_loop))))
  (local.get $visible)
 )

 (func $wasm/kernels/batchProjectSegments
  (param $count i32) (param $lutOff i32)
  (param $srcLatsOff i32) (param $srcLonsOff i32) (param $dstLatsOff i32) (param $dstLonsOff i32)
  (param $outSegsPtr i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (param $minX f32) (param $minY f32) (param $maxX f32) (param $maxY f32)
  (result i32)
  (call $batchProjectSegmentsImpl
   (local.get $count) (local.get $lutOff)
   (local.get $srcLatsOff) (local.get $srcLonsOff) (local.get $dstLatsOff) (local.get $dstLonsOff)
   (local.get $outSegsPtr)
   (local.get $centerNormX) (local.get $centerNormY) (local.get $worldSize) (local.get $halfW) (local.get $halfH)
   (local.get $minX) (local.get $minY) (local.get $maxX) (local.get $maxY)
   (i32.const 0))
 )

 (func $wasm/kernels/batchProjectSegmentsI16
  (param $count i32) (param $lutOff i32)
  (param $srcLatsOff i32) (param $srcLonsOff i32) (param $dstLatsOff i32) (param $dstLonsOff i32)
  (param $outSegsPtr i32)
  (param $centerNormX f32) (param $centerNormY f32) (param $worldSize f32) (param $halfW f32) (param $halfH f32)
  (param $minX f32) (param $minY f32) (param $maxX f32) (param $maxY f32)
  (result i32)
  (call $batchProjectSegmentsImpl
   (local.get $count) (local.get $lutOff)
   (local.get $srcLatsOff) (local.get $srcLonsOff) (local.get $dstLatsOff) (local.get $dstLonsOff)
   (local.get $outSegsPtr)
   (local.get $centerNormX) (local.get $centerNormY) (local.get $worldSize) (local.get $halfW) (local.get $halfH)
   (local.get $minX) (local.get $minY) (local.get $maxX) (local.get $maxY)
   (i32.const 1))
 )
)
