import { buildDrawingAreas } from './buildDrawingAreas'
import { ChannelFuncs } from '../WorkerPool'
import { RenderStrategy } from '../'

/** 100 is kind of optimal repaint ratio (1% per 'frame-column'). More areas cause more worker overhead */
export const SPREAD_AREAS_AMOUNT = 100

export const render: RenderStrategy<{ spread?: number }> = (
  funcsPool,
  channel,
  {
    spread = SPREAD_AREAS_AMOUNT,
    width: intrinsicWidth,
    height: intrinsicHeight,
    ...restRenderProps
  },
  drawRegion,
  scale = 1,
) => {
  let cancelled = false

  const renderWidth = intrinsicWidth * scale
  const renderHeight = intrinsicHeight * scale

  // [0, step, 2*step, ..., width-step, width] = N+1 elements
  const drawingAreas = buildDrawingAreas(renderWidth, spread)

  // shuffled [0 to N-1] = N elements
  const shuffledAreas = new Array(spread).fill(0).map((_, i) => i)
  unbiasedOptimalShuffle(shuffledAreas)

  // Create recursive pool queue over the shuffled areas
  let areaQueueIndex = 0
  const queueNextFramePartial = async (funcs: ChannelFuncs): Promise<unknown> => {
    // pick next uniformly random area
    const areaIndex = shuffledAreas[areaQueueIndex++]
    const widthFrom = drawingAreas[areaIndex]
    const widthTo = drawingAreas[areaIndex + 1]

    // perform calcs on the area
    const bitmap = await funcs[channel]({
      ...restRenderProps,
      width: renderWidth,
      height: renderHeight,
      widthFrom,
      widthTo,
    })

    if (!cancelled) {
      // commit partial
      const intrinsicWidthFrom = widthFrom / scale
      const intrinsicWidthTo = widthTo / scale
      drawRegion(bitmap, intrinsicWidthFrom, intrinsicWidthTo)

      // continue promise-chains until all areas are processed
      if (areaQueueIndex < spread) {
        return queueNextFramePartial(funcs)
      } // else render is complete
    } // else abort
  }

  // Launch recursive promise-chains render pipeline on the worker pool
  // Compute {SPREAD_AREAS_AMOUNT} frame partials using {funcsPool.length} concurrently running jobs
  const rendering = Promise.all(funcsPool.map(queueNextFramePartial))
  return {
    /** Concurrent Spread Strategy is multi-frame multi-worker operation, therefore it has many abort-boundaries */
    abort: () => { cancelled = true },
    progress: rendering
  }
}

function unbiasedOptimalShuffle<T>(array: T[]) {
  const maxIdx = array.length - 1 // n-1

  for (let i = 0; i < maxIdx - 2; i++) {
    // 0 <=      R      <  1
    // 0 <=   R*(n-i)   <  i
    // i <= R*(n-i) + i < n-i+i = n

    // i <= j < n

    let j = Math.floor(Math.random() * (maxIdx - i) + i)

    // swap
    let temp = array[i]
    array[i] = array[j]
    array[j] = temp
  }
}
