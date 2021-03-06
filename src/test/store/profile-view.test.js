/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import type { TrackReference } from '../../types/actions';
import type { TabSlug } from '../../app-logic/tabs-handling';

import {
  getProfileFromTextSamples,
  getMergedProfileFromTextSamples,
  getProfileWithMarkers,
  getNetworkTrackProfile,
  getScreenshotTrackProfile,
  getNetworkMarkers,
  getCounterForThread,
  getVisualProgressTrackProfile,
  getProfileWithUnbalancedNativeAllocations,
  getProfileWithJsAllocations,
} from '../fixtures/profiles/processed-profile';
import {
  getEmptyThread,
  getEmptyProfile,
} from '../../profile-logic/data-structures';
import { withAnalyticsMock } from '../fixtures/mocks/analytics';
import { getProfileWithNiceTracks } from '../fixtures/profiles/tracks';
import { blankStore, storeWithProfile } from '../fixtures/stores';
import { assertSetContainsOnly } from '../fixtures/custom-assertions';

import * as App from '../../actions/app';
import * as ProfileView from '../../actions/profile-view';
import {
  viewProfile,
  changeViewAndRecomputeProfileData,
} from '../../actions/receive-profile';
import * as ProfileViewSelectors from '../../selectors/profile';
import * as UrlStateSelectors from '../../selectors/url-state';
import { getRightClickedCallNodeInfo } from '../../selectors/right-clicked-call-node';
import { getRightClickedMarkerInfo } from '../../selectors/right-clicked-marker';
import { stateFromLocation } from '../../app-logic/url-handling';
import {
  selectedThreadSelectors,
  selectedNodeSelectors,
  getThreadSelectors,
} from '../../selectors/per-thread';
import { ensureExists } from '../../utils/flow';

import type { Milliseconds } from '../../types/units';
import type { BreakdownByCategory } from '../../profile-logic/profile-data';
import type { BrowsingContextID } from '../../types/profile';

describe('call node paths on implementation filter change', function() {
  const {
    profile,
    funcNamesPerThread: [funcNames],
  } = getProfileFromTextSamples(`
    A.cpp
    B.js
    C.cpp
    D.js
    E.js
    F.cpp
  `);
  const threadIndex = 0;
  const A = funcNames.indexOf('A.cpp');
  const B = funcNames.indexOf('B.js');
  const C = funcNames.indexOf('C.cpp');
  const D = funcNames.indexOf('D.js');
  const E = funcNames.indexOf('E.js');

  it('starts with combined CallNodePaths', function() {
    const { dispatch, getState } = storeWithProfile(profile);
    dispatch(ProfileView.changeSelectedCallNode(threadIndex, [A, B, C, D, E]));
    expect(
      selectedThreadSelectors.getSelectedCallNodePath(getState())
    ).toEqual([A, B, C, D, E]);

    assertSetContainsOnly(
      selectedThreadSelectors.getExpandedCallNodePaths(getState()),
      [
        // Paths
        [A],
        [A, B],
        [A, B, C],
        [A, B, C, D],
      ]
    );
  });

  it('starts with js CallNodePaths', function() {
    const { dispatch, getState } = storeWithProfile(profile);
    dispatch(ProfileView.changeImplementationFilter('js'));
    dispatch(ProfileView.changeSelectedCallNode(threadIndex, [B, D, E]));
    expect(
      selectedThreadSelectors.getSelectedCallNodePath(getState())
    ).toEqual([B, D, E]);

    assertSetContainsOnly(
      selectedThreadSelectors.getExpandedCallNodePaths(getState()),
      [
        // Paths
        [B],
        [B, D],
      ]
    );
  });

  it('strips away the C++ functions when going from combined to JS', function() {
    const { dispatch, getState } = storeWithProfile(profile);
    dispatch(ProfileView.changeSelectedCallNode(threadIndex, [A, B, C, D, E]));
    dispatch(ProfileView.changeImplementationFilter('js'));
    expect(
      selectedThreadSelectors.getSelectedCallNodePath(getState())
    ).toEqual([B, D, E]);

    assertSetContainsOnly(
      selectedThreadSelectors.getExpandedCallNodePaths(getState()),
      [
        // Paths
        [B],
        [B, D],
      ]
    );
  });

  it('re-adds the C++ functions when going from JS to combined', function() {
    const { dispatch, getState } = storeWithProfile(profile);
    dispatch(ProfileView.changeImplementationFilter('js'));
    dispatch(ProfileView.changeSelectedCallNode(threadIndex, [B, D, E]));
    dispatch(ProfileView.changeImplementationFilter('combined'));
    expect(
      selectedThreadSelectors.getSelectedCallNodePath(getState())
    ).toEqual([A, B, C, D, E]);

    assertSetContainsOnly(
      selectedThreadSelectors.getExpandedCallNodePaths(getState()),
      [
        // Paths
        [A],
        [A, B],
        [A, B, C],
        [A, B, C, D],
      ]
    );
  });

  it('can go from JS to C++ views', function() {
    const { dispatch, getState } = storeWithProfile(profile);
    dispatch(ProfileView.changeImplementationFilter('js'));
    dispatch(ProfileView.changeSelectedCallNode(threadIndex, [B, D, E]));
    dispatch(ProfileView.changeImplementationFilter('cpp'));
    expect(
      selectedThreadSelectors.getSelectedCallNodePath(getState())
    ).toEqual([A, C]);
    assertSetContainsOnly(
      selectedThreadSelectors.getExpandedCallNodePaths(getState()),
      [
        // Paths
        [A],
      ]
    );
  });
});

describe('getJankMarkersForHeader', function() {
  function setupWithResponsiveness({ sampleCount, responsiveness }) {
    const { profile } = getProfileFromTextSamples(
      Array(sampleCount)
        .fill('A')
        .join('  ')
    );
    delete profile.threads[0].samples.eventDelay;
    profile.threads[0].samples.responsiveness = responsiveness;
    const { getState } = storeWithProfile(profile);
    const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
    return selectedThreadSelectors
      .getJankMarkerIndexesForHeader(getState())
      .map(getMarker);
  }

  function setupWithEventDelay({ sampleCount, eventDelay }) {
    const { profile } = getProfileFromTextSamples(
      Array(sampleCount)
        .fill('A')
        .join('  ')
    );
    delete profile.threads[0].samples.eventDelay;
    profile.threads[0].samples.eventDelay = eventDelay;
    const { getState } = storeWithProfile(profile);
    const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
    return selectedThreadSelectors
      .getJankMarkerIndexesForHeader(getState())
      .map(getMarker);
  }

  it('will not create any jank markers for undefined responsiveness', function() {
    const jankInstances = setupWithResponsiveness({
      sampleCount: 10,
      responsiveness: [],
    });
    expect(jankInstances).toEqual([]);
  });

  it('will not create any jank markers for null responsiveness', function() {
    const responsiveness = Array(10).fill(null);
    const jankInstances = setupWithResponsiveness({
      sampleCount: responsiveness.length,
      responsiveness,
    });
    expect(jankInstances).toEqual([]);
  });

  it('will create a jank instance', function() {
    const breakingPoint = 70;
    const responsiveness = [0, 20, 40, 60, breakingPoint, 0, 20, 40];
    const jankInstances = setupWithResponsiveness({
      sampleCount: responsiveness.length,
      responsiveness,
    });
    expect(jankInstances.length).toEqual(1);
    expect(jankInstances[0].dur).toEqual(breakingPoint);
  });

  it('will create a jank instance with eventDelay values', function() {
    const breakingPoint = 70;
    const eventDelay = [0, 20, 40, 60, breakingPoint, 0, 20, 40];
    const jankInstances = setupWithEventDelay({
      sampleCount: eventDelay.length,
      eventDelay,
    });
    expect(jankInstances.length).toEqual(1);
    expect(jankInstances[0].dur).toEqual(breakingPoint);
  });

  it('will skip null responsiveness values', function() {
    const breakingPoint = 70;
    const responsiveness = [0, 20, 40, null, breakingPoint, null, 0, 20, 40];
    const jankInstances = setupWithResponsiveness({
      sampleCount: responsiveness.length,
      responsiveness,
    });
    expect(jankInstances.length).toEqual(1);
    expect(jankInstances[0].dur).toEqual(breakingPoint);
  });

  it('will skip null responsiveness values after a breaking point', function() {
    const breakingPoint = 70;
    const responsiveness = [0, 20, 40, 60, breakingPoint, null, 10, 20];
    const jankInstances = setupWithResponsiveness({
      sampleCount: responsiveness.length,
      responsiveness,
    });
    expect(jankInstances.length).toEqual(1);
    expect(jankInstances[0].dur).toEqual(breakingPoint);
  });
});

/**
 * The following tests run through a dispatch and selector to provide coverage
 * over the Redux store to ensure that it behaves correctly. The intent is to cover
 * every single action, but do the bare minimum in the test to assert the relationship
 * between the actions, reducers, and selectors.
 */
describe('actions/ProfileView', function() {
  describe('changeSelectedCallNode', function() {
    it('can change the call node', function() {
      const { profile } = getProfileFromTextSamples(`
        A
        B
        C
        `);
      const { dispatch, getState } = storeWithProfile(profile);

      expect(
        selectedThreadSelectors.getSelectedCallNodePath(getState())
      ).toEqual([]);
      dispatch(ProfileView.changeSelectedCallNode(0, [0, 1]));
      expect(
        selectedThreadSelectors.getSelectedCallNodePath(getState())
      ).toEqual([0, 1]);
    });
  });

  describe('changeSelectedThread', function() {
    it('can set and change the selected thread', function() {
      const { profile } = getProfileFromTextSamples('A', 'B');
      const { dispatch, getState } = storeWithProfile(profile);

      expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(0);
      dispatch(ProfileView.changeSelectedThread(1));
      expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(1);
    });
  });

  describe('selectTrack', function() {
    /**
     * Using the following tracks:
     *  [
     *    'show [thread GeckoMain process]',
     *    'show [thread GeckoMain tab]',
     *    '  - show [thread DOM Worker]',
     *    '  - show [thread Style]',
     *  ]
     */
    const parentTrackReference = { type: 'global', trackIndex: 0 };
    const tabTrackReference = { type: 'global', trackIndex: 1 };
    const workerTrackReference = { type: 'local', trackIndex: 0, pid: 222 };

    function storeWithTab(tabSlug: TabSlug) {
      const profile = getProfileWithNiceTracks();
      const { dispatch, getState } = blankStore();
      const newUrlState = stateFromLocation({
        pathname: `/public/1ecd7a421948995171a4bb483b7bcc8e1868cc57/${tabSlug}/`,
        search: '',
        hash: '',
      });
      dispatch({
        type: 'UPDATE_URL_STATE',
        newUrlState,
      });
      dispatch(viewProfile(profile));

      return { profile, dispatch, getState };
    }

    function setup(tabSlug: TabSlug = 'calltree') {
      const { profile, dispatch, getState } = storeWithTab(tabSlug);
      const parentTrack = ProfileViewSelectors.getGlobalTrackFromReference(
        getState(),
        parentTrackReference
      );
      const tabTrack = ProfileViewSelectors.getGlobalTrackFromReference(
        getState(),
        tabTrackReference
      );
      const workerTrack = ProfileViewSelectors.getLocalTrackFromReference(
        getState(),
        workerTrackReference
      );
      if (tabTrack.type !== 'process' || parentTrack.type !== 'process') {
        throw new Error('Expected to get process tracks.');
      }
      if (workerTrack.type !== 'thread') {
        throw new Error('Expected to get a thread tracks.');
      }
      return {
        profile,
        getState,
        dispatch,
        parentTrack,
        tabTrack,
        workerTrack,
      };
    }

    describe('with a thread tracks', function() {
      it('starts out with the tab thread selected', function() {
        const { getState, tabTrack } = setup();
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(
          tabTrack.mainThreadIndex
        );
      });

      it('can switch to another global track', function() {
        const { getState, dispatch, parentTrack } = setup();
        dispatch(ProfileView.selectTrack(parentTrackReference));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(
          parentTrack.mainThreadIndex
        );
      });

      it('can switch to a local track', function() {
        const { getState, dispatch, workerTrack } = setup();
        dispatch(ProfileView.selectTrack(workerTrackReference));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(
          workerTrack.threadIndex
        );
      });
    });

    describe('with a network track', function() {
      const threadTrack: TrackReference = {
        type: 'local',
        trackIndex: 0,
        pid: 0,
      };
      const networkTrack: TrackReference = {
        type: 'local',
        trackIndex: 1,
        pid: 0,
      };
      it('it starts out with the thread track and call tree selected', function() {
        const profile = getNetworkTrackProfile();
        const { getState } = storeWithProfile(profile);
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(0);
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'calltree'
        );
      });
      it('it can switch to the network track, which selects the network chart tab', function() {
        const profile = getNetworkTrackProfile();
        const { dispatch, getState } = storeWithProfile(profile);
        dispatch(ProfileView.selectTrack(networkTrack));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(0);
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'network-chart'
        );
      });
      it('it can switch back to the thread, which remembers the last viewed panel', function() {
        const profile = getNetworkTrackProfile();
        const { dispatch, getState } = storeWithProfile(profile);
        dispatch(App.changeSelectedTab('flame-graph'));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(0);
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'flame-graph'
        );
        dispatch(ProfileView.selectTrack(networkTrack));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(0);
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'network-chart'
        );
        dispatch(ProfileView.selectTrack(threadTrack));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(0);
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'flame-graph'
        );
      });
    });

    describe('with a memory track', function() {
      const memoryTrackReference = { type: 'local', trackIndex: 0, pid: 111 };

      function setup() {
        const profile = getProfileWithNiceTracks();

        {
          // Modify the profile to add a memory track.
          const parentThreadIndex = profile.threads.findIndex(
            thread =>
              thread.name === 'GeckoMain' && thread.processType === 'process'
          );
          if (parentThreadIndex === -1) {
            throw new Error('Could not find the parent process main thread.');
          }
          const parentThread = profile.threads[parentThreadIndex];

          const counter = getCounterForThread(parentThread, parentThreadIndex);
          counter.category = 'Memory';
          profile.counters = [counter];
        }

        const store = storeWithProfile(profile);

        {
          // Verify the memory track reference is correct.
          const memoryTrack = ProfileViewSelectors.getLocalTrackFromReference(
            store.getState(),
            memoryTrackReference
          );
          if (memoryTrack.type !== 'memory') {
            throw new Error('Expected to get memory track.');
          }
        }

        return store;
      }

      it('changes the thread index when selected', function() {
        const { getState, dispatch } = setup();
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(1);
        dispatch(ProfileView.selectTrack(memoryTrackReference));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(0);
      });

      it('does not change the tab when selected', function() {
        const { getState, dispatch } = setup();
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'calltree'
        );
        dispatch(ProfileView.selectTrack(memoryTrackReference));
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'calltree'
        );
      });
    });

    describe('with a comparison profile', function() {
      it('selects the calltree tab when selecting the diffing track', function() {
        const diffingTrackReference = {
          type: 'global',
          trackIndex: 2,
        };

        const { profile } = getMergedProfileFromTextSamples(
          'A  B  C',
          'A  B  B'
        );
        const { getState, dispatch } = storeWithProfile(profile);

        dispatch(App.changeSelectedTab('flame-graph'));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(0);
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'flame-graph'
        );

        dispatch(ProfileView.selectTrack(diffingTrackReference));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(2);
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'calltree'
        );
      });
    });

    describe('with allocation-based tracks', function() {
      function setup() {
        const { profile } = getProfileWithUnbalancedNativeAllocations();
        profile.threads.push(
          getProfileWithJsAllocations().profile.threads[0],
          getEmptyThread()
        );

        for (const thread of profile.threads) {
          thread.pid = 0;
        }

        // Create some references in the same order that the threads were created
        // in the threads array.
        const nativeAllocationsThread: TrackReference = {
          type: 'local',
          trackIndex: 0,
          pid: 0,
        };
        const jsAllocationsThread: TrackReference = {
          type: 'local',
          trackIndex: 1,
          pid: 0,
        };
        const timingOnlyThread: TrackReference = {
          type: 'local',
          trackIndex: 2,
          pid: 0,
        };

        return {
          profile,
          nativeAllocationsThread,
          timingOnlyThread,
          jsAllocationsThread,
          ...storeWithProfile(profile),
        };
      }

      it('will switch to a "timing" summary strategy when clicking from a native allocation, to a timings-only thread', function() {
        const { profile, nativeAllocationsThread, timingOnlyThread } = setup();
        const { dispatch, getState } = storeWithProfile(profile);

        // Setup the test to view native allocations.
        dispatch(ProfileView.selectTrack(nativeAllocationsThread));
        dispatch(
          ProfileView.changeCallTreeSummaryStrategy('native-allocations')
        );
        expect(
          selectedThreadSelectors.getCallTreeSummaryStrategy(getState())
        ).toEqual('native-allocations');

        // Switch to a thread without native allocations.
        dispatch(ProfileView.selectTrack(timingOnlyThread));

        // Expect that it switches the summary strategy to one it supports.
        expect(
          selectedThreadSelectors.getCallTreeSummaryStrategy(getState())
        ).toEqual('timing');
      });

      it('will switch to a "timing" summary strategy when clicking from a js allocation, to a timings-only thread', function() {
        const { profile, jsAllocationsThread, timingOnlyThread } = setup();
        const { dispatch, getState } = storeWithProfile(profile);

        // Setup the test to view js allocations.
        dispatch(ProfileView.selectTrack(jsAllocationsThread));
        dispatch(ProfileView.changeCallTreeSummaryStrategy('js-allocations'));
        expect(
          selectedThreadSelectors.getCallTreeSummaryStrategy(getState())
        ).toEqual('js-allocations');

        // Switch to a thread without js allocations.
        dispatch(ProfileView.selectTrack(timingOnlyThread));

        // Expect that it switches the summary strategy to one it supports.
        expect(
          selectedThreadSelectors.getCallTreeSummaryStrategy(getState())
        ).toEqual('timing');
      });
    });

    describe('when the loaded panel is not the call tree', function() {
      it('stays in the same panel when selecting another track', function() {
        const { getState, dispatch, parentTrack } = setup('marker-chart');
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'marker-chart'
        );
        dispatch(ProfileView.selectTrack(parentTrackReference));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(
          parentTrack.mainThreadIndex
        );
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'marker-chart'
        );
      });

      it('moves to the call tree when then initial tab is the network chart', function() {
        const { getState, dispatch, parentTrack } = setup('network-chart');
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'network-chart'
        );
        dispatch(ProfileView.selectTrack(parentTrackReference));
        expect(UrlStateSelectors.getSelectedThreadIndex(getState())).toEqual(
          parentTrack.mainThreadIndex
        );
        expect(UrlStateSelectors.getSelectedTab(getState())).toEqual(
          'calltree'
        );
      });
    });
  });

  describe('focusCallTree', function() {
    it('updates the focus call tree generation', function() {
      const { profile } = getProfileFromTextSamples('A');
      const { dispatch, getState } = storeWithProfile(profile);

      expect(
        ProfileViewSelectors.getFocusCallTreeGeneration(getState())
      ).toEqual(0);
      dispatch(ProfileView.focusCallTree());
      expect(
        ProfileViewSelectors.getFocusCallTreeGeneration(getState())
      ).toEqual(1);
    });
  });

  describe('changeRightClickedTrack', function() {
    it('changes the right clicked thread index', function() {
      const { profile } = getProfileFromTextSamples('A', 'B');
      const { dispatch, getState } = storeWithProfile(profile);

      expect(ProfileViewSelectors.getRightClickedTrack(getState())).toEqual(
        null
      );
      dispatch(
        ProfileView.changeRightClickedTrack({ trackIndex: 1, type: 'global' })
      );
      expect(ProfileViewSelectors.getRightClickedTrack(getState())).toEqual({
        trackIndex: 1,
        type: 'global',
      });
    });
  });

  describe('changeCallTreeSearchString', function() {
    it('changes the call tree search string', function() {
      const { profile } = getProfileFromTextSamples('A', 'B', 'C');
      const { dispatch, getState } = storeWithProfile(profile);

      withAnalyticsMock(() => {
        expect(UrlStateSelectors.getCurrentSearchString(getState())).toEqual(
          ''
        );
        dispatch(ProfileView.changeCallTreeSearchString('foobar'));
        expect(UrlStateSelectors.getCurrentSearchString(getState())).toEqual(
          'foobar'
        );

        expect(self.ga).toBeCalledWith('send', {
          eventAction: 'call tree search string',
          eventCategory: 'profile',
          hitType: 'event',
        });
      });
    });
  });

  /**
   * This test is more involved on checking for correctness compared to the other
   * tests, which are more for asserting their simple getter/setter types of behavior.
   */
  describe('expandAllCallNodeDescendants', function() {
    function setupStore() {
      const {
        profile,
        funcNamesPerThread: [funcNames],
      } = getProfileFromTextSamples(`
        A  A  A
        B  B  E
        C  D
      `);
      const threadIndex = 0;
      const A = funcNames.indexOf('A');
      const B = funcNames.indexOf('B');
      const C = funcNames.indexOf('C');
      const D = funcNames.indexOf('D');
      const E = funcNames.indexOf('E');
      const { getState, dispatch } = storeWithProfile(profile);
      return { A, B, C, D, E, threadIndex, getState, dispatch };
    }

    it('expands whole tree from root', function() {
      const { getState, dispatch, threadIndex, A, B, C, D, E } = setupStore();
      const callNodeInfo = selectedThreadSelectors.getCallNodeInfo(getState());

      // Before expand all action is dispatched, nothing is expanded
      expect(
        Array.from(selectedThreadSelectors.getExpandedCallNodePaths(getState()))
      ).toEqual([]);

      dispatch(
        ProfileView.expandAllCallNodeDescendants(
          threadIndex,
          0, // A
          callNodeInfo
        )
      );

      assertSetContainsOnly(
        selectedThreadSelectors.getExpandedCallNodePaths(getState()),
        [
          // Paths
          [A],
          [A, B],
          [A, B, C],
          [A, B, D],
          [A, E],
        ]
      );
    });

    // assertSetContainsOnly is an assertion.
    // eslint-disable-next-line jest/expect-expect
    it('expands subtrees', function() {
      const { getState, dispatch, threadIndex, A, B, C, D } = setupStore();

      // First expand A by selecting B
      dispatch(ProfileView.changeSelectedCallNode(threadIndex, [A, B]));

      const callNodeInfo = selectedThreadSelectors.getCallNodeInfo(getState());

      // Before expand all action is dispatched, only A is expanded
      assertSetContainsOnly(
        selectedThreadSelectors.getExpandedCallNodePaths(getState()),
        [
          // Paths
          [A],
        ]
      );

      dispatch(
        ProfileView.expandAllCallNodeDescendants(
          threadIndex,
          1, // B
          callNodeInfo
        )
      );

      assertSetContainsOnly(
        selectedThreadSelectors.getExpandedCallNodePaths(getState()),
        [
          // Paths
          [A],
          [A, B],
          [A, B, C],
          [A, B, D],
        ]
      );
    });
  });

  describe('changeExpandedCallNodes', function() {
    it('changes the expanded call nodes', function() {
      const { profile } = getProfileFromTextSamples(`
        A
        B
        C
        D
        `);
      const { dispatch, getState } = storeWithProfile(profile);

      expect(
        Array.from(selectedThreadSelectors.getExpandedCallNodePaths(getState()))
      ).toEqual([]);
      dispatch(ProfileView.changeExpandedCallNodes(0, [[0], [0, 1]]));
      assertSetContainsOnly(
        selectedThreadSelectors.getExpandedCallNodePaths(getState()),
        [[0], [0, 1]]
      );
    });
  });

  describe('changeSelectedMarker', function() {
    it('changes the selected marker', function() {
      const profile = getProfileWithMarkers([
        ['a', 0, null],
        ['b', 1, null],
      ]);
      const { dispatch, getState } = storeWithProfile(profile);

      expect(
        selectedThreadSelectors.getViewOptions(getState()).selectedMarker
      ).toEqual(null);
      dispatch(ProfileView.changeSelectedMarker(0, 0));
      expect(
        selectedThreadSelectors.getViewOptions(getState()).selectedMarker
      ).toEqual(0);
    });
  });

  describe('changeMarkersSearchString', function() {
    it('changes the search string', function() {
      const profile = getProfileWithMarkers([
        ['a', 0, null],
        ['b', 1, null],
      ]);
      const { dispatch, getState } = storeWithProfile(profile);

      expect(UrlStateSelectors.getMarkersSearchString(getState())).toEqual('');
      dispatch(ProfileView.changeMarkersSearchString('a'));
      expect(UrlStateSelectors.getMarkersSearchString(getState())).toEqual('a');
    });

    it('filters the markers by name', function() {
      const profile = getProfileWithMarkers([
        ['a', 0, null],
        ['b', 1, null],
        ['c', 2, null],
      ]);
      const { dispatch, getState } = storeWithProfile(profile);

      expect(
        selectedThreadSelectors.getSearchFilteredMarkerIndexes(getState())
      ).toHaveLength(3);
      dispatch(ProfileView.changeMarkersSearchString('A, b'));

      const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
      const markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(2);
      expect(getMarker(markerIndexes[0]).name.includes('a')).toBeTruthy();
      expect(getMarker(markerIndexes[1]).name.includes('b')).toBeTruthy();
    });

    it('filters the markers by a potential data payload of type FileIO', function() {
      const profile = getProfileWithMarkers([
        ['a', 0, null],
        ['b', 1, null],
        ['c', 2, null],
        [
          'd',
          3,
          {
            cause: { stack: 2, time: 1 },
            endTime: 1024,
            filename: '/foo/bar/',
            operation: 'create/open',
            source: 'PoisionOIInterposer',
            startTime: 1022,
            type: 'FileIO',
          },
        ],
      ]);
      const { dispatch, getState } = storeWithProfile(profile);

      // Tests the filename
      expect(
        selectedThreadSelectors.getSearchFilteredMarkerIndexes(getState())
      ).toHaveLength(4);
      dispatch(ProfileView.changeMarkersSearchString('/foo/bar/'));

      const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
      let markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(1);
      expect(getMarker(markerIndexes[0]).name.includes('d')).toBeTruthy();

      // Tests the filename, but with a substring
      dispatch(ProfileView.changeMarkersSearchString('foo'));

      markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(1);
      expect(getMarker(markerIndexes[0]).name.includes('d')).toBeTruthy();

      // Tests the operation
      dispatch(ProfileView.changeMarkersSearchString('open'));

      markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(1);
      expect(getMarker(markerIndexes[0]).name.includes('d')).toBeTruthy();

      // Tests the source
      dispatch(ProfileView.changeMarkersSearchString('Interposer'));

      markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(1);
      expect(getMarker(markerIndexes[0]).name.includes('d')).toBeTruthy();
    });

    it('filters the markers by a potential data payload of type IPC', function() {
      const profile = getProfileWithMarkers([
        ['a', 0, null],
        [
          'b',
          1,
          {
            type: 'IPC',
            startTime: 30,
            endTime: 1031,
            otherPid: 3333,
            otherTid: 3333,
            otherThreadName: 'Parent Process (Thread ID: 3333)',
            messageSeqno: 1,
            messageType: 'PContent::Msg_PreferenceUpdate',
            side: 'child',
            direction: 'receiving',
            sync: false,
          },
        ],
        ['c', 2, null],
        [
          'd',
          3,
          {
            type: 'IPC',
            startTime: 40,
            endTime: 40,
            otherPid: 9999,
            messageSeqno: 2,
            messageType: 'PContent::Msg_PreferenceUpdate',
            side: 'parent',
            direction: 'sending',
            sync: false,
          },
        ],
      ]);
      const { dispatch, getState } = storeWithProfile(profile);

      expect(
        selectedThreadSelectors.getSearchFilteredMarkerIndexes(getState())
      ).toHaveLength(4);

      // Tests the messageType
      dispatch(ProfileView.changeMarkersSearchString('PContent'));

      const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
      let markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(2);
      expect(getMarker(markerIndexes[0]).name.includes('IPCIn')).toBeTruthy();
      expect(getMarker(markerIndexes[1]).name.includes('IPCOut')).toBeTruthy();

      // Tests otherPid
      dispatch(ProfileView.changeMarkersSearchString('3333'));

      markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(1);
      expect(getMarker(markerIndexes[0]).name.includes('IPCIn')).toBeTruthy();

      dispatch(ProfileView.changeMarkersSearchString('9'));

      markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(1);
      expect(getMarker(markerIndexes[0]).name.includes('IPCOut')).toBeTruthy();
    });

    describe('filters the markers by a potential data payload of type Log', function() {
      function setup() {
        const profile = getProfileWithMarkers([
          ['a', 0, null],
          ['b', 1, null],
          ['c', 2, null],
          [
            'd',
            3,
            {
              type: 'Log',
              module: 'nsJarProtocol',
              name: 'nsJARChannel::nsJARChannel [this=0x87f1ec80]\n',
            },
          ],
        ]);
        const { dispatch, getState } = storeWithProfile(profile);

        // Do a simple check to make sure we're in the proper state.
        expect(
          selectedThreadSelectors.getSearchFilteredMarkerIndexes(getState())
        ).toHaveLength(4);

        const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
        return { dispatch, getState, getMarker };
      }

      it('filters the module property', function() {
        const { dispatch, getState, getMarker } = setup();

        dispatch(ProfileView.changeMarkersSearchString('Protocol'));
        const markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
          getState()
        );
        expect(markerIndexes).toHaveLength(1);
        expect(getMarker(markerIndexes[0]).name.includes('d')).toBeTruthy();
      });

      it('filters the the payload name property', function() {
        const { dispatch, getState, getMarker } = setup();

        dispatch(ProfileView.changeMarkersSearchString('jarchannel'));
        const markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
          getState()
        );
        expect(markerIndexes).toHaveLength(1);
        expect(getMarker(markerIndexes[0]).name.includes('d')).toBeTruthy();
      });

      it('filters using the marker name itself', function() {
        const { dispatch, getState, getMarker } = setup();

        dispatch(ProfileView.changeMarkersSearchString('log'));
        const markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
          getState()
        );
        expect(markerIndexes).toHaveLength(1);
        expect(getMarker(markerIndexes[0]).name.includes('d')).toBeTruthy();
      });
    });

    it('filters the markers by other properties of a potential data payload', function() {
      const profile = getProfileWithMarkers([
        [
          'a',
          0,
          {
            type: 'tracing',
            category: 'DOMEvent',
            timeStamp: 1001,
            interval: 'start',
            eventType: 'mousedown',
            phase: 1,
          },
        ],
        [
          'b',
          1,
          {
            type: 'UserTiming',
            startTime: 1002,
            endTime: 1022,
            name: 'mark-1',
            entryType: 'mark',
          },
        ],
        ['c', 2, null],
        [
          'd',
          3,
          {
            type: 'UserTiming',
            startTime: 1050,
            endTime: 1100,
            name: 'measure-1',
            entryType: 'measure',
          },
        ],
      ]);
      const { dispatch, getState } = storeWithProfile(profile);

      expect(
        selectedThreadSelectors.getSearchFilteredMarkerIndexes(getState())
      ).toHaveLength(4);

      // Tests searching for the name of usertiming markers.
      dispatch(ProfileView.changeMarkersSearchString('mark, measure'));

      const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
      let markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(2);
      expect(getMarker(markerIndexes[0]).name.includes('b')).toBeTruthy();
      expect(getMarker(markerIndexes[1]).name.includes('d')).toBeTruthy();

      // Tests searching for the DOMEVent type
      dispatch(ProfileView.changeMarkersSearchString('mouse'));

      markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(1);
      expect(getMarker(markerIndexes[0]).name.includes('a')).toBeTruthy();

      // This tests searching in the category.
      dispatch(ProfileView.changeMarkersSearchString('dom'));

      markerIndexes = selectedThreadSelectors.getSearchFilteredMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(1);
      expect(getMarker(markerIndexes[0]).name.includes('a')).toBeTruthy();
    });
  });

  describe('changeNetworkSearchString', function() {
    it('changes the search string', function() {
      const profile = getNetworkTrackProfile();
      const { dispatch, getState } = storeWithProfile(profile);

      expect(UrlStateSelectors.getNetworkSearchString(getState())).toEqual('');
      dispatch(ProfileView.changeNetworkSearchString('a'));
      expect(UrlStateSelectors.getNetworkSearchString(getState())).toEqual('a');
    });

    it('filters the network markers', function() {
      const profile = getNetworkTrackProfile();
      const { dispatch, getState } = storeWithProfile(profile);
      const networkSearchString = '3';

      expect(
        selectedThreadSelectors.getSearchFilteredNetworkMarkerIndexes(
          getState()
        )
      ).toHaveLength(10);
      dispatch(ProfileView.changeNetworkSearchString(networkSearchString));

      const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
      const markerIndexes = selectedThreadSelectors.getSearchFilteredNetworkMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(1);
      expect(
        getMarker(markerIndexes[0]).name.includes(networkSearchString)
      ).toBeTruthy();
    });

    it('filters multiple network markers', function() {
      const profile = getNetworkTrackProfile();
      const { dispatch, getState } = storeWithProfile(profile);
      const networkSearchString = '3, 4';

      expect(
        selectedThreadSelectors.getSearchFilteredNetworkMarkerIndexes(
          getState()
        )
      ).toHaveLength(10);
      dispatch(ProfileView.changeNetworkSearchString(networkSearchString));

      const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
      const markerIndexes = selectedThreadSelectors.getSearchFilteredNetworkMarkerIndexes(
        getState()
      );
      expect(markerIndexes).toHaveLength(2);
      expect(getMarker(markerIndexes[0]).name.includes('3')).toBeTruthy();
      expect(getMarker(markerIndexes[1]).name.includes('4')).toBeTruthy();
    });
  });

  describe('changeImplementationFilter', function() {
    it('changes the implementation filter', function() {
      const { profile } = getProfileFromTextSamples('A');
      const { dispatch, getState } = storeWithProfile(profile);

      expect(UrlStateSelectors.getImplementationFilter(getState())).toEqual(
        'combined'
      );
      withAnalyticsMock(() => {
        dispatch(ProfileView.changeImplementationFilter('js'));
        expect(self.ga).toBeCalledWith('send', {
          eventAction: 'change implementation filter',
          eventCategory: 'profile',
          eventLabel: 'js',
          hitType: 'event',
        });
      });
      expect(UrlStateSelectors.getImplementationFilter(getState())).toEqual(
        'js'
      );
    });
  });

  describe('changeInvertCallstack', function() {
    it('changes the callstack inversion', function() {
      const { profile } = getProfileFromTextSamples('A');
      const { dispatch, getState } = storeWithProfile(profile);

      expect(UrlStateSelectors.getInvertCallstack(getState())).toEqual(false);
      withAnalyticsMock(() => {
        dispatch(ProfileView.changeInvertCallstack(true));
        expect(self.ga).toBeCalledWith('send', {
          eventAction: 'change invert callstack',
          eventCategory: 'profile',
          hitType: 'event',
        });
      });
      expect(UrlStateSelectors.getInvertCallstack(getState())).toEqual(true);
    });
  });

  describe('updatePreviewSelection', function() {
    it('updates the profile selection', function() {
      const { profile } = getProfileFromTextSamples('A');
      const { dispatch, getState } = storeWithProfile(profile);

      expect(ProfileViewSelectors.getPreviewSelection(getState())).toEqual({
        hasSelection: false,
        isModifying: false,
      });
      dispatch(
        ProfileView.updatePreviewSelection({
          hasSelection: true,
          isModifying: false,
          selectionStart: 0,
          selectionEnd: 1,
        })
      );
      expect(ProfileViewSelectors.getPreviewSelection(getState())).toEqual({
        hasSelection: true,
        isModifying: false,
        selectionStart: 0,
        selectionEnd: 1,
      });
    });
  });

  describe('commitRange', function() {
    it('commits a range', function() {
      const { profile } = getProfileFromTextSamples('A');
      const { dispatch, getState } = storeWithProfile(profile);

      expect(UrlStateSelectors.getAllCommittedRanges(getState())).toEqual([]);
      dispatch(ProfileView.commitRange(0, 10));
      expect(UrlStateSelectors.getAllCommittedRanges(getState())).toEqual([
        { start: 0, end: 10 },
      ]);

      expect(ProfileViewSelectors.getPreviewSelectionRange(getState())).toEqual(
        {
          start: 0,
          end: 10,
        }
      );

      dispatch(ProfileView.commitRange(1, 9));
      expect(UrlStateSelectors.getAllCommittedRanges(getState())).toEqual([
        { start: 0, end: 10 },
        { start: 1, end: 9 },
      ]);

      expect(ProfileViewSelectors.getPreviewSelectionRange(getState())).toEqual(
        {
          start: 1,
          end: 9,
        }
      );
    });
  });

  describe('commitRangeAndUnsetSelection', function() {
    it('commits a range and unsets a selection', function() {
      const { profile } = getProfileFromTextSamples('A');
      const { dispatch, getState } = storeWithProfile(profile);

      dispatch(ProfileView.commitRange(0, 10));
      dispatch(
        ProfileView.updatePreviewSelection({
          hasSelection: true,
          isModifying: false,
          selectionStart: 1,
          selectionEnd: 9,
        })
      );
      expect(UrlStateSelectors.getAllCommittedRanges(getState())).toEqual([
        { start: 0, end: 10 },
      ]);
      expect(ProfileViewSelectors.getPreviewSelection(getState())).toEqual({
        hasSelection: true,
        isModifying: false,
        selectionStart: 1,
        selectionEnd: 9,
      });
      expect(ProfileViewSelectors.getPreviewSelectionRange(getState())).toEqual(
        {
          start: 1,
          end: 9,
        }
      );

      dispatch(ProfileView.commitRange(2, 8));
      expect(UrlStateSelectors.getAllCommittedRanges(getState())).toEqual([
        { start: 0, end: 10 },
        { start: 2, end: 8 },
      ]);
      expect(ProfileViewSelectors.getPreviewSelection(getState())).toEqual({
        hasSelection: false,
        isModifying: false,
      });
      expect(ProfileViewSelectors.getPreviewSelectionRange(getState())).toEqual(
        {
          start: 2,
          end: 8,
        }
      );
    });
  });

  describe('popCommittedRanges', function() {
    function setupStore() {
      const { profile } = getProfileFromTextSamples('A');
      const store = storeWithProfile(profile);
      store.dispatch(ProfileView.commitRange(0, 10));
      store.dispatch(ProfileView.commitRange(1, 9));
      store.dispatch(ProfileView.commitRange(2, 8));
      store.dispatch(ProfileView.commitRange(3, 7));
      return store;
    }

    it('pops a committed range', function() {
      const { getState, dispatch } = setupStore();
      expect(UrlStateSelectors.getAllCommittedRanges(getState())).toEqual([
        { start: 0, end: 10 },
        { start: 1, end: 9 },
        { start: 2, end: 8 },
        { start: 3, end: 7 },
      ]);
      dispatch(ProfileView.popCommittedRanges(2));
      expect(UrlStateSelectors.getAllCommittedRanges(getState())).toEqual([
        { start: 0, end: 10 },
        { start: 1, end: 9 },
      ]);
    });

    it('pops a committed range and unsets the selection', function() {
      const { getState, dispatch } = setupStore();
      dispatch(
        ProfileView.updatePreviewSelection({
          hasSelection: true,
          isModifying: false,
          selectionStart: 1,
          selectionEnd: 9,
        })
      );
      expect(ProfileViewSelectors.getPreviewSelection(getState())).toEqual({
        hasSelection: true,
        isModifying: false,
        selectionEnd: 9,
        selectionStart: 1,
      });
      expect(UrlStateSelectors.getAllCommittedRanges(getState())).toEqual([
        { start: 0, end: 10 },
        { start: 1, end: 9 },
        { start: 2, end: 8 },
        { start: 3, end: 7 },
      ]);

      dispatch(ProfileView.popCommittedRanges(2));
      expect(UrlStateSelectors.getAllCommittedRanges(getState())).toEqual([
        { start: 0, end: 10 },
        { start: 1, end: 9 },
      ]);
      expect(ProfileViewSelectors.getPreviewSelection(getState())).toEqual({
        hasSelection: false,
        isModifying: false,
      });
    });
  });

  describe('addTransformToStack', function() {
    it('can add a transform to the stack', function() {
      const { profile } = getProfileFromTextSamples(`
        A
        B
        C
        `);
      const { dispatch, getState } = storeWithProfile(profile);

      expect(UrlStateSelectors.getTransformStack(getState(), 0)).toEqual([]);
      withAnalyticsMock(() => {
        dispatch(
          ProfileView.addTransformToStack(0, {
            type: 'merge-function',
            funcIndex: 1,
          })
        );
        expect(self.ga).toBeCalledWith('send', {
          eventAction: 'add transform',
          eventCategory: 'profile',
          eventLabel: 'merge-function',
          hitType: 'event',
        });
      });
      expect(UrlStateSelectors.getTransformStack(getState(), 0)).toEqual([
        {
          type: 'merge-function',
          funcIndex: 1,
        },
      ]);
    });
  });

  describe('popTransformToStack', function() {
    it('can add and remove a transform to the stack', function() {
      const { profile } = getProfileFromTextSamples(`
        A
        B
        C
        `);
      const { dispatch, getState } = storeWithProfile(profile);

      dispatch(
        ProfileView.addTransformToStack(0, {
          type: 'merge-function',
          funcIndex: 1,
        })
      );
      dispatch(
        ProfileView.addTransformToStack(0, {
          type: 'merge-function',
          funcIndex: 2,
        })
      );
      expect(UrlStateSelectors.getTransformStack(getState(), 0)).toEqual([
        {
          type: 'merge-function',
          funcIndex: 1,
        },
        {
          type: 'merge-function',
          funcIndex: 2,
        },
      ]);
      dispatch(ProfileView.popTransformsFromStack(1));
      expect(UrlStateSelectors.getTransformStack(getState(), 0)).toEqual([
        {
          type: 'merge-function',
          funcIndex: 1,
        },
      ]);
    });
  });

  describe('getRangeFilteredScreenshotsById', function() {
    it('can extract some network markers and match the snapshot', function() {
      const profile = getScreenshotTrackProfile();
      const { getState } = storeWithProfile(profile);
      const screenshotMarkersById = selectedThreadSelectors.getRangeFilteredScreenshotsById(
        getState()
      );
      const keys = [...screenshotMarkersById.keys()];
      expect(keys.length).toEqual(2);

      const [screenshots] = [...screenshotMarkersById.values()];
      if (!screenshots) {
        throw new Error('No screenshots found.');
      }
      // The profile contains the same markers twice, but with different window ids.
      // `screenshots` contains the screenshots for only one window id.
      // That's why we need to halve the markers length when comparing the 2 lengths.
      expect(screenshots.length).toEqual(profile.threads[0].markers.length / 2);
      for (const screenshot of screenshots) {
        expect(screenshot.name).toEqual('CompositorScreenshot');
      }
    });

    it('only deliveres screenshots within a range selection', function() {
      const profile = getScreenshotTrackProfile();
      const [{ markers }] = profile.threads;
      const { dispatch, getState } = storeWithProfile(profile);

      // Double check that there are 10 markers in the test data, and commit a
      // subsection of that range.
      expect(markers.length).toBe(20);
      const startIndex = 3;
      const endIndex = 8;
      const startTime = markers.time[startIndex];
      const endTime = markers.time[endIndex];
      dispatch(ProfileView.commitRange(startTime, endTime));

      // Get out the markers.
      const screenshotMarkersById = selectedThreadSelectors.getRangeFilteredScreenshotsById(
        getState()
      );
      const [key] = [...screenshotMarkersById.keys()];
      const screenshots = screenshotMarkersById.get(key);
      if (!screenshots) {
        throw new Error('No screenshots found.');
      }
      expect(screenshots.length).toEqual(endIndex - startIndex + 1);
    });
  });
});

/**
 * Naively run through all the selectors. The correctness of what they are computing
 * should be left up to better informed unit tests. This provides some base coverage
 * of mechanically running through the selectors in tests.
 */
describe('snapshots of selectors/profile', function() {
  const browsingContextID = 123123;
  const innerWindowID = 2;

  // Set up a profile that has some nice features that can show that the selectors work.
  function setupStore() {
    const {
      profile,
      funcNamesPerThread: [funcNames],
    } = getProfileFromTextSamples(`
      A  A  A  A  A  A  A  A  A
      B  B  B  B  B  B  B  B  B
      C  C  C  C  C  C  H  H  H
      D  D  D  F  F  F  I  I  I
      E  E  E  G  G  G
    `);
    const A = funcNames.indexOf('A');
    const B = funcNames.indexOf('B');
    const C = funcNames.indexOf('C');

    profile.pages = [
      {
        browsingContextID: browsingContextID,
        innerWindowID: innerWindowID,
        url: 'https://developer.mozilla.org/en-US/',
        embedderInnerWindowID: 0,
      },
    ];

    profile.meta.configuration = {
      threads: [],
      features: [],
      capacity: 1000000,
      activeBrowsingContextID: browsingContextID,
    };

    const [samplesThread] = profile.threads;

    // Add innerWindowID for G function
    const G = funcNames.indexOf('G');
    for (
      let frameIdx = 0;
      frameIdx < samplesThread.frameTable.length;
      frameIdx++
    ) {
      const func = samplesThread.frameTable.func[frameIdx];
      if (func === G) {
        samplesThread.frameTable.innerWindowID[frameIdx] = innerWindowID;
      }
    }

    // Add in a thread with markers
    const {
      threads: [markersThread],
    } = getProfileWithMarkers([
      ['A', 0, null],
      ['B', 1, null],
      ['C', 2, null],
      ['D', 3, null],
      ['E', 4, null],
      ['F', 5, null],
      ...getNetworkMarkers({ id: 6, startTime: 6 }),
      ...getNetworkMarkers({ id: 7, startTime: 7 }),
    ]);
    profile.threads.push(markersThread);
    const { getState, dispatch } = storeWithProfile(profile);
    samplesThread.name = 'Thread with samples';
    markersThread.name = 'Thread with markers';
    // This is a jank sample:
    ensureExists(samplesThread.samples.eventDelay)[4] = 100;
    const mergeFunction = {
      type: 'merge-function',
      funcIndex: C,
    };
    dispatch(ProfileView.addTransformToStack(0, mergeFunction));
    dispatch(ProfileView.changeExpandedCallNodes(0, [[A], [A, B]]));
    dispatch(ProfileView.changeSelectedCallNode(0, [A, B]));
    dispatch(ProfileView.changeSelectedMarker(0, 1));
    dispatch(ProfileView.commitRange(3, 7)); // Reminder: upper bound "7" is exclusive.
    dispatch(
      ProfileView.updatePreviewSelection({
        hasSelection: true,
        isModifying: false,
        selectionStart: 4,
        selectionEnd: 6,
      })
    );
    return {
      getState,
      dispatch,
      samplesThread,
      mergeFunction,
      markerThreadSelectors: getThreadSelectors(1),
      getMarker: getThreadSelectors(1).getMarkerGetter(getState()),
      A,
      B,
      C,
    };
  }
  it('matches the last stored run of getProfile', function() {
    const { getState } = setupStore();
    expect(ProfileViewSelectors.getProfile(getState())).toMatchSnapshot();
  });
  it('matches the last stored run of getProfileInterval', function() {
    const { getState } = setupStore();
    expect(ProfileViewSelectors.getProfileInterval(getState())).toEqual(1);
  });
  it('matches the last stored run of getThreads', function() {
    const { getState } = setupStore();
    expect(ProfileViewSelectors.getThreads(getState())).toMatchSnapshot();
  });
  it('matches the last stored run of getThreadNames', function() {
    const { getState } = setupStore();
    expect(ProfileViewSelectors.getThreadNames(getState())).toEqual([
      'Thread with samples',
      'Thread with markers',
    ]);
  });
  it('matches the last stored run of getRightClickedTrack', function() {
    const { getState } = setupStore();
    expect(ProfileViewSelectors.getRightClickedTrack(getState())).toEqual(null);
  });
  it('matches the last stored run of selectedThreadSelector.getThread', function() {
    const { getState, samplesThread } = setupStore();
    expect(selectedThreadSelectors.getThread(getState())).toEqual(
      samplesThread
    );
  });
  it('matches the last stored run of selectedThreadSelector.getViewOptions', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getViewOptions(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getTransformStack', function() {
    const { getState, mergeFunction } = setupStore();
    expect(selectedThreadSelectors.getTransformStack(getState())).toEqual([
      mergeFunction,
    ]);
  });
  it('matches the last stored run of selectedThreadSelector.getTransformLabels', function() {
    const { getState } = setupStore();
    expect(selectedThreadSelectors.getTransformLabels(getState())).toEqual([
      'Complete "Thread with samples"',
      'Merge: C',
    ]);
  });
  it('matches the last stored run of selectedThreadSelector.getTabFilteredThread', function() {
    const { getState, dispatch } = setupStore();

    dispatch(changeViewAndRecomputeProfileData(browsingContextID));
    expect(
      selectedThreadSelectors.getTabFilteredThread(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getRangeFilteredThread', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getRangeFilteredThread(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getRangeAndTransformFilteredThread', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getRangeAndTransformFilteredThread(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getJankMarkersForHeader', function() {
    const { getState } = setupStore();
    const getMarker = selectedThreadSelectors.getMarkerGetter(getState());
    expect(
      selectedThreadSelectors
        .getJankMarkerIndexesForHeader(getState())
        .map(getMarker)
    ).toMatchSnapshot();
  });
  it('matches the last stored run of markerThreadSelectors.getProcessedRawMarkerTable', function() {
    const { getState, markerThreadSelectors } = setupStore();
    expect(
      markerThreadSelectors.getProcessedRawMarkerTable(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of markerThreadSelectors.getFullMarkerListIndexes', function() {
    const { getState, markerThreadSelectors, getMarker } = setupStore();
    expect(
      markerThreadSelectors.getFullMarkerListIndexes(getState()).map(getMarker)
    ).toMatchSnapshot();
  });
  it('matches the last stored run of markerThreadSelectors.getMarkerChartTimingAndBuckets', function() {
    const { getState, markerThreadSelectors } = setupStore();
    expect(
      markerThreadSelectors.getMarkerChartTimingAndBuckets(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of markerThreadSelectors.getCommittedRangeFilteredMarkerIndexes', function() {
    const { getState, markerThreadSelectors, getMarker } = setupStore();
    expect(
      markerThreadSelectors
        .getCommittedRangeFilteredMarkerIndexes(getState())
        .map(getMarker)
    ).toMatchSnapshot();
  });
  it('matches the last stored run of markerThreadSelectors.getCommittedRangeAndTabFilteredMarkerIndexesForHeader', function() {
    const { getState, markerThreadSelectors, getMarker } = setupStore();
    expect(
      markerThreadSelectors
        .getCommittedRangeAndTabFilteredMarkerIndexesForHeader(getState())
        .map(getMarker)
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getFilteredThread', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getFilteredThread(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getPreviewFilteredThread', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getPreviewFilteredThread(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getCallNodeInfo', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getCallNodeInfo(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getCallNodeMaxDepth', function() {
    const { getState } = setupStore();
    expect(selectedThreadSelectors.getCallNodeMaxDepth(getState())).toEqual(4);
  });
  it('matches the last stored run of selectedThreadSelector.getSelectedCallNodePath', function() {
    const { getState, A, B } = setupStore();
    expect(
      selectedThreadSelectors.getSelectedCallNodePath(getState())
    ).toEqual([A, B]);
  });
  it('matches the last stored run of selectedThreadSelector.getSelectedCallNodeIndex', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getSelectedCallNodeIndex(getState())
    ).toEqual(1);
  });
  // assertSetContainsOnly is an assertion
  // eslint-disable-next-line jest/expect-expect
  it('matches the last stored run of selectedThreadSelector.getExpandedCallNodePaths', function() {
    const { getState, A, B } = setupStore();
    assertSetContainsOnly(
      selectedThreadSelectors.getExpandedCallNodePaths(getState()),
      [[A], [A, B]]
    );
  });
  it('matches the last stored run of selectedThreadSelector.getExpandedCallNodeIndexes', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getExpandedCallNodeIndexes(getState())
    ).toEqual([0, 1]);
  });
  it('matches the last stored run of selectedThreadSelector.getCallTree', function() {
    const { getState } = setupStore();
    expect(selectedThreadSelectors.getCallTree(getState())).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getFlameGraphTiming', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getFlameGraphTiming(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.getFriendlyThreadName', function() {
    const { getState } = setupStore();
    expect(selectedThreadSelectors.getFriendlyThreadName(getState())).toEqual(
      'Thread with samples'
    );
  });
  it('matches the last stored run of selectedThreadSelector.getThreadProcessDetails', function() {
    const { getState } = setupStore();
    expect(
      selectedThreadSelectors.getThreadProcessDetails(getState())
    ).toMatchSnapshot();
  });
  it('matches the last stored run of markerThreadSelectors.getSearchFilteredMarkerIndexes', function() {
    const { getState, markerThreadSelectors, getMarker } = setupStore();
    expect(
      markerThreadSelectors
        .getSearchFilteredMarkerIndexes(getState())
        .map(getMarker)
    ).toMatchSnapshot();
  });
  it('matches the last stored run of selectedThreadSelector.unfilteredSamplesRange', function() {
    const { getState } = setupStore();
    expect(selectedThreadSelectors.unfilteredSamplesRange(getState())).toEqual({
      end: 9,
      start: 0,
    });
  });

  it('matches the last stored run of selectedNodeSelectors.getName', () => {
    const { getState } = setupStore();
    expect(selectedNodeSelectors.getName(getState())).toEqual('B');
  });

  it('matches the last stored run of selectedNodeSelectors.getIsJS', () => {
    const { getState } = setupStore();
    expect(selectedNodeSelectors.getIsJS(getState())).toEqual(false);
  });

  it('matches the last stored run of selectedNodeSelectors.getLib', () => {
    const { getState } = setupStore();
    expect(selectedNodeSelectors.getLib(getState())).toEqual('');
  });

  it('matches the last stored run of selectedNodeSelectors.getTimingsForSidebar', () => {
    const { getState } = setupStore();
    expect(
      selectedNodeSelectors.getTimingsForSidebar(getState())
    ).toMatchSnapshot();
  });
});

describe('getTimingsForSidebar', () => {
  function setup() {
    const { profile, funcNamesDictPerThread } = getProfileFromTextSamples(`
      A    A                  A             A             A              A
      B    B                  B             B             B              B
      Cjs  Cjs                Cjs           Cjs           H[cat:Layout]  H[cat:Layout]
      D    D                  D             F             I[cat:Idle]
      E    Ejs[jit:baseline]  Ejs[jit:ion]  Ejs[jit:ion]
    `);

    const store = storeWithProfile(profile);

    // Committing a range exercizes the offset code for committed ranges.
    // Note that we'll exercize the offset code for preview selections in a
    // specific test below.
    store.dispatch(ProfileView.commitRange(1, 6));

    const getTimingsForPath = path => {
      store.dispatch(ProfileView.changeSelectedCallNode(0, path));
      return selectedNodeSelectors.getTimingsForSidebar(store.getState());
    };

    return {
      ...store,
      funcNamesDict: funcNamesDictPerThread[0],
      getTimingsForPath,
    };
  }

  // Creates a BreakdownByCategory for the case where every category has just one
  // subcategory (the "Other" subcategory), so that it's easier to write the
  // reference structures.
  function withSingleSubcategory(
    categoryBreakdown: Milliseconds[]
  ): BreakdownByCategory {
    return categoryBreakdown.map(value => ({
      entireCategoryValue: value,
      subcategoryBreakdown: [value],
    }));
  }

  describe('in a non-inverted tree', function() {
    it('returns good timings for a root node', () => {
      const {
        funcNamesDict: { A },
        getTimingsForPath,
      } = setup();

      // This is a root node: it should have no self time but all the total time.
      const timings = getTimingsForPath([A]);
      expect(timings).toEqual({
        forPath: {
          selfTime: {
            value: 0,
            breakdownByImplementation: null,
            breakdownByCategory: null,
          },
          totalTime: {
            value: 5,
            breakdownByImplementation: { native: 2, baseline: 1, ion: 2 },
            breakdownByCategory: withSingleSubcategory([
              1, // Idle
              0, // Other
              1, // Layout
              3, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
        },
        forFunc: {
          selfTime: {
            value: 0,
            breakdownByImplementation: null,
            breakdownByCategory: null,
          },
          totalTime: {
            value: 5,
            breakdownByImplementation: { native: 2, baseline: 1, ion: 2 },
            breakdownByCategory: withSingleSubcategory([
              1, // Idle
              0, // Other
              1, // Layout
              3, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
        },
        rootTime: 5,
      });
    });

    it('returns good timings for a leaf node, also present in other stacks', () => {
      const {
        getTimingsForPath,
        funcNamesDict: { A, B, Cjs, D, Ejs },
      } = setup();

      // This is a leaf node: it should have some self time and some total time
      // holding the same value.
      //
      // This is also a JS node so it should have some js engine implementation
      // implementations.
      //
      // The same func is also present in 2 different stacks so it should have
      // different timings for the `forFunc` property.
      const timings = getTimingsForPath([A, B, Cjs, D, Ejs]);
      expect(timings).toEqual({
        forPath: {
          selfTime: {
            value: 2,
            breakdownByImplementation: { ion: 1, baseline: 1 },
            breakdownByCategory: withSingleSubcategory([
              0, // Idle
              0, // Other
              0, // Layout
              2, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
          totalTime: {
            value: 2,
            breakdownByImplementation: { ion: 1, baseline: 1 },
            breakdownByCategory: withSingleSubcategory([
              0, // Idle
              0, // Other
              0, // Layout
              2, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
        },
        forFunc: {
          selfTime: {
            value: 3,
            breakdownByImplementation: { ion: 2, baseline: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              0,
              3, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
          totalTime: {
            value: 3,
            breakdownByImplementation: { ion: 2, baseline: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              0,
              3, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
        },
        rootTime: 5,
      });
    });

    it('returns good timings for a node that has both children and self time', () => {
      const {
        getTimingsForPath,
        funcNamesDict: { A, B, H },
      } = setup();

      // This is a node that has both children and some self time. So it should
      // have some running time that's different than the self time.
      const timings = getTimingsForPath([A, B, H]);
      expect(timings).toEqual({
        forPath: {
          selfTime: {
            value: 1,
            breakdownByImplementation: { native: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
          totalTime: {
            value: 2,
            breakdownByImplementation: { native: 2 },

            breakdownByCategory: withSingleSubcategory([
              1, // Idle
              0,
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
        },
        forFunc: {
          selfTime: {
            value: 1,
            breakdownByImplementation: { native: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
          totalTime: {
            value: 2,
            breakdownByImplementation: { native: 2 },
            breakdownByCategory: withSingleSubcategory([
              1, // Idle
              0,
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
        },
        rootTime: 5,
      });
    });

    it('returns good timings for preview selections', () => {
      const {
        dispatch,
        funcNamesDict: { A },
        getTimingsForPath,
      } = setup();

      dispatch(
        ProfileView.updatePreviewSelection({
          hasSelection: true,
          isModifying: false,
          selectionStart: 3,
          selectionEnd: 5,
        })
      );

      const timings = getTimingsForPath([A]);

      // We don't test the whole object, just one part, because in this test
      // we're more interested in testing if the offset logic is working.
      expect(timings.rootTime).toEqual(2);
      expect(timings.forPath.totalTime).toEqual({
        value: 2,
        breakdownByImplementation: { native: 1, ion: 1 },
        breakdownByCategory: withSingleSubcategory([
          1, // Idle
          0, // Other
          0, // Layout
          1, // JavaScript
          0,
          0,
          0,
          0,
        ]),
      });
    });
  });

  describe('for an inverted tree', function() {
    function setupForInvertedTree() {
      const setupResult = setup();
      const { dispatch } = setupResult;

      dispatch(ProfileView.changeInvertCallstack(true));
      // Now the profile should look like this:
      //
      // E    Ejs  Ejs  Ejs  I[cat:Idle]    H[cat:Layout]
      // D    D    D    F    H[cat:Layout]  B
      // Cjs  Cjs  Cjs  Cjs  B              A
      // B    B    B    B    A
      // A    A    A    A

      return setupResult;
    }

    it('returns good timings for a root node', () => {
      const {
        getTimingsForPath,
        funcNamesDict: { Ejs },
      } = setupForInvertedTree();
      const timings = getTimingsForPath([Ejs]);
      expect(timings).toEqual({
        forPath: {
          selfTime: {
            value: 3,
            breakdownByImplementation: null,
            breakdownByCategory: null,
          },
          totalTime: {
            value: 3,
            breakdownByImplementation: { ion: 2, baseline: 1 },
            breakdownByCategory: withSingleSubcategory([
              0, // Idle
              0, // Other
              0, // Layout
              3, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
        },
        forFunc: {
          selfTime: {
            value: 3,
            breakdownByImplementation: { ion: 2, baseline: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              0,
              3, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
          totalTime: {
            value: 3,
            breakdownByImplementation: { ion: 2, baseline: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              0,
              3, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
        },
        rootTime: 5,
      });
    });

    it('returns good timings for a node present in several stacks without self time', () => {
      const {
        getTimingsForPath,
        funcNamesDict: { Ejs, D, Cjs, B },
      } = setupForInvertedTree();
      const timings = getTimingsForPath([Ejs, D, Cjs, B]);
      expect(timings).toEqual({
        forPath: {
          selfTime: {
            value: 0,
            breakdownByImplementation: null,
            breakdownByCategory: null,
          },
          totalTime: {
            value: 2,
            breakdownByImplementation: { ion: 1, baseline: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              0,
              2, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
        },
        forFunc: {
          selfTime: {
            value: 0,
            breakdownByImplementation: null,
            breakdownByCategory: null,
          },
          totalTime: {
            value: 5,
            breakdownByImplementation: {
              ion: 2,
              baseline: 1,
              native: 2,
            },
            breakdownByCategory: withSingleSubcategory([
              1, // Idle
              0, // Other
              1, // Layout
              3, // JavaScript
              0,
              0,
              0,
              0,
            ]),
          },
        },
        rootTime: 5,
      });
    });

    it('returns good timings for a node present in several stacks with self time', () => {
      const {
        getTimingsForPath,
        funcNamesDict: { I, H },
      } = setupForInvertedTree();

      // Select the function as a root node
      let timings = getTimingsForPath([H]);
      expect(timings).toEqual({
        forPath: {
          selfTime: {
            value: 1,
            breakdownByImplementation: null,
            breakdownByCategory: null,
          },
          totalTime: {
            value: 1,
            breakdownByImplementation: { native: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
        },
        forFunc: {
          selfTime: {
            value: 1,
            breakdownByImplementation: { native: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
          totalTime: {
            value: 2,
            breakdownByImplementation: { native: 2 },
            breakdownByCategory: withSingleSubcategory([
              1, // Idle
              0, // Other
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
        },
        rootTime: 5,
      });

      // Select the same function, but this time when it's not a root node
      timings = getTimingsForPath([I, H]);
      expect(timings).toEqual({
        forPath: {
          selfTime: {
            value: 0,
            breakdownByImplementation: null,
            breakdownByCategory: null,
          },
          totalTime: {
            value: 1,
            breakdownByImplementation: { native: 1 },
            breakdownByCategory: withSingleSubcategory([
              1, // Idle
              0,
              0,
              0,
              0,
              0,
              0,
              0,
            ]),
          },
        },
        forFunc: {
          selfTime: {
            value: 1,
            breakdownByImplementation: { native: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
          totalTime: {
            value: 2,
            breakdownByImplementation: { native: 2 },
            breakdownByCategory: withSingleSubcategory([
              1, // Idle
              0,
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
        },
        rootTime: 5,
      });
    });

    it('returns good timings for a leaf node', () => {
      const {
        getTimingsForPath,
        funcNamesDict: { H, B, A },
      } = setupForInvertedTree();
      const timings = getTimingsForPath([H, B, A]);
      expect(timings).toEqual({
        forPath: {
          selfTime: {
            value: 0,
            breakdownByImplementation: null,
            breakdownByCategory: null,
          },
          totalTime: {
            value: 1,
            breakdownByImplementation: { native: 1 },
            breakdownByCategory: withSingleSubcategory([
              0,
              0,
              1, // Layout
              0,
              0,
              0,
              0,
              0,
            ]),
          },
        },
        forFunc: {
          selfTime: {
            value: 0,
            breakdownByImplementation: null,
            breakdownByCategory: null,
          },
          totalTime: {
            value: 5,
            breakdownByImplementation: { native: 2, ion: 2, baseline: 1 },
            breakdownByCategory: withSingleSubcategory([
              1, // Idle
              0,
              1, // Layout
              3, // JavaScript
              0,
              0,
              0,
              0,
            ]), // [Idle, Other, Layout, JavaScript]
          },
        },
        rootTime: 5,
      });
    });

    it('returns good timings for preview selections', () => {
      const {
        dispatch,
        funcNamesDict: { Ejs },
        getTimingsForPath,
      } = setupForInvertedTree();

      dispatch(
        ProfileView.updatePreviewSelection({
          hasSelection: true,
          isModifying: false,
          selectionStart: 3,
          selectionEnd: 5,
        })
      );

      const timings = getTimingsForPath([Ejs]);

      // We don't test the whole object, just one part, because in this test
      // we're more interested in testing if the offset logic is working.
      expect(timings.rootTime).toEqual(2);
      expect(timings.forPath.totalTime).toEqual({
        value: 1,
        breakdownByImplementation: { ion: 1 },
        breakdownByCategory: withSingleSubcategory([
          0, // Idle
          0, // Other
          0, // Layout
          1, // JavaScript
          0,
          0,
          0,
          0,
        ]),
      });
    });
  });

  describe('for a diffing track', function() {
    function setup() {
      const {
        profile,
        funcNamesDictPerThread,
      } = getMergedProfileFromTextSamples(
        `
        A              A  A
        B              B  C
        D[cat:Layout]  E  F
      `,
        `
        A                  A  A
        B                  B  B
        G[cat:JavaScript]  I  E
      `
      );

      const store = storeWithProfile(profile);
      store.dispatch(ProfileView.changeSelectedThread(2));

      const getTimingsForPath = path => {
        store.dispatch(ProfileView.changeSelectedCallNode(2, path));
        return selectedNodeSelectors.getTimingsForSidebar(store.getState());
      };

      return {
        getTimingsForPath,
        funcNamesDictPerThread,
      };
    }

    it('computes the right breakdowns', () => {
      const {
        getTimingsForPath,
        funcNamesDictPerThread: [{ A }],
      } = setup();
      const timings = getTimingsForPath([A]);
      expect(timings.forPath).toEqual({
        selfTime: {
          breakdownByCategory: null,
          breakdownByImplementation: null,
          value: 0,
        },
        totalTime: {
          breakdownByCategory: withSingleSubcategory([0, 0, -1, 1, 0, 0, 0, 0]), // Idle, Other, Layout, JavaScript, etc.
          breakdownByImplementation: {
            native: 0,
          },
          value: 0,
        },
      });
    });
  });
});

// Verify that getFriendlyThreadName gives the expected names for threads with or without processName.
describe('getFriendlyThreadName', function() {
  // Setup a profile with threads based on the given overrides.
  function setup(threadOverrides: Array<*>) {
    const profile = getEmptyProfile();
    for (const threadOverride of threadOverrides) {
      profile.threads.push(getEmptyThread(threadOverride));
    }

    const { dispatch, getState } = storeWithProfile(profile);

    const getFriendlyThreadNames = () =>
      profile.threads.map((_, threadIndex) =>
        getThreadSelectors(threadIndex).getFriendlyThreadName(getState())
      );

    return { profile, dispatch, getState, getFriendlyThreadNames };
  }

  it('uses names based on GeckoMain processTypes when there are no processNames', function() {
    const { getFriendlyThreadNames } = setup([
      { name: 'GeckoMain', processType: 'default' },
      { name: 'GeckoMain', processType: 'tab' },
      { name: 'GeckoMain', processType: 'gpu' },
      { name: 'GeckoMain', processType: 'plugin' },
      { name: 'GeckoMain', processType: 'socket' },
    ]);
    expect(getFriendlyThreadNames()).toEqual([
      'Parent Process',
      'Content Process',
      'GPU Process',
      'Plugin Process',
      'Socket Process',
    ]);
  });

  it('uses names based on GeckoMain processTypes (and counts multiple tabs) when there are no processNames', function() {
    const { getFriendlyThreadNames } = setup([
      { name: 'GeckoMain', processType: 'default' },
      { name: 'GeckoMain', processType: 'tab' },
      { name: 'GeckoMain', processType: 'gpu' },
      { name: 'GeckoMain', processType: 'tab' },
      { name: 'GeckoMain', processType: 'socket' },
    ]);
    expect(getFriendlyThreadNames()).toEqual([
      'Parent Process',
      'Content Process (1/2)',
      'GPU Process',
      'Content Process (2/2)',
      'Socket Process',
    ]);
  });

  it('uses processName for GeckoMain threads that have one', function() {
    const { getFriendlyThreadNames } = setup([
      { name: 'GeckoMain', processName: 'A' },
      { name: 'GeckoMain', processName: 'B' },
      { name: 'GeckoMain', processName: 'C' },
      { name: 'GeckoMain', processType: 'gpu' },
      { name: 'GeckoMain', processName: 'B' },
      { name: 'GeckoMain', processName: 'B' },
      { name: 'GeckoMain', processName: 'C' },
    ]);
    expect(getFriendlyThreadNames()).toEqual([
      'A',
      'B (1/3)',
      'C (1/2)',
      'GPU Process',
      'B (2/3)',
      'B (3/3)',
      'C (2/2)',
    ]);
  });
});

describe('counter selectors', function() {
  const { getCounterSelectors } = ProfileViewSelectors;
  function setup() {
    const { profile } = getProfileFromTextSamples(
      Array(10)
        .fill('A')
        .join('  ')
    );
    const threadIndex = 0;
    const thread = profile.threads[threadIndex];
    const counterA = getCounterForThread(thread, threadIndex);
    const counterB = getCounterForThread(thread, threadIndex);
    profile.counters = [counterA, counterB];
    const { getState, dispatch } = storeWithProfile(profile);
    return { getState, dispatch, counterA, counterB };
  }

  it('can get the counters', function() {
    const { counterA, counterB, getState } = setup();
    expect(getCounterSelectors(0).getCounter(getState())).toBe(counterA);
    expect(getCounterSelectors(1).getCounter(getState())).toBe(counterB);
  });

  it('can get the counter description', function() {
    const { getState } = setup();
    expect(getCounterSelectors(0).getDescription(getState())).toBe(
      'My Description'
    );
  });

  it('can get the counter pid', function() {
    const { getState } = setup();
    expect(getCounterSelectors(0).getPid(getState())).toBe(0);
  });

  it('can get the commited range filtered counters', function() {
    const { getState, dispatch } = setup();
    // The range includes the sample just before and the sample just after the selection
    // range.
    dispatch(ProfileView.commitRange(3.5, 5.5));
    const originalCounter = getCounterSelectors(0).getCounter(getState());
    expect(originalCounter.sampleGroups[0].samples.time).toEqual([
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
    ]);

    const filteredCounter = getCounterSelectors(
      0
    ).getCommittedRangeFilteredCounter(getState());
    expect(filteredCounter.sampleGroups[0].samples.time).toEqual([3, 4, 5, 6]);
  });

  it('can accumulate samples', function() {
    const { getState, counterA } = setup();
    counterA.sampleGroups[0].samples.count = [
      // The first value gets zeroed out due to a work-around for Bug 1520587. It
      // can be much larger than all the rest of the values, as it doesn't ever
      // get reset.
      10000,
      -2,
      3,
      -5,
      7,
      -11,
      13,
      -17,
      19,
      23,
    ];
    expect(
      getCounterSelectors(0).getAccumulateCounterSamples(getState())[0]
    ).toEqual({
      accumulatedCounts: [0, -2, 1, -4, 3, -8, 5, -12, 7, 30],
      countRange: 42,
      maxCount: 30,
      minCount: -12,
    });
  });
});

describe('meta selector', function() {
  const { getMeta } = ProfileViewSelectors;
  function setup() {
    const { profile } = getProfileFromTextSamples(
      Array(10)
        .fill('A')
        .join('  ')
    );
    const { meta } = profile;
    const { getState } = storeWithProfile(profile);
    return { getState, meta };
  }

  it('can get meta', function() {
    const { getState, meta } = setup();
    expect(getMeta(getState())).toBe(meta);
  });
});

describe('visual metrics selectors', function() {
  const {
    getVisualMetrics,
    getVisualProgress,
    getPerceptualSpeedIndexProgress,
    getContentfulSpeedIndexProgress,
  } = ProfileViewSelectors;
  function setup() {
    const profile = getVisualProgressTrackProfile(
      Array(10)
        .fill('A')
        .join('  ')
    );
    const {
      meta: { visualMetrics },
    } = profile;

    if (!visualMetrics) {
      throw new Error('No visual metrics found.');
    }

    const { getState } = storeWithProfile(profile);
    return { getState, visualMetrics };
  }

  it('can get visual metrics', function() {
    const { getState, visualMetrics } = setup();
    expect(getVisualMetrics(getState())).toEqual(visualMetrics);
  });

  it('can get visual progress', function() {
    const {
      getState,
      visualMetrics: { VisualProgress },
    } = setup();
    expect(getVisualProgress(getState())).toEqual(VisualProgress);
  });

  it('can get perceptual visual progress', function() {
    const {
      getState,
      visualMetrics: { PerceptualSpeedIndexProgress },
    } = setup();
    expect(getPerceptualSpeedIndexProgress(getState())).toEqual(
      PerceptualSpeedIndexProgress
    );
  });

  it('can get contentful visual progress', function() {
    const {
      getState,
      visualMetrics: { ContentfulSpeedIndexProgress },
    } = setup();
    expect(getContentfulSpeedIndexProgress(getState())).toEqual(
      ContentfulSpeedIndexProgress
    );
  });
});

describe('right clicked call node info', () => {
  function setup() {
    const profile = getProfileFromTextSamples(`
      A
      B
      C
    `);

    return storeWithProfile(profile.profile);
  }

  it('should be empty on store creation', () => {
    const { getState } = setup();

    expect(getRightClickedCallNodeInfo(getState())).toBeNull();
  });

  it('sets right clicked call node info when right clicked call node action is dispatched', () => {
    const { dispatch, getState } = setup();

    expect(getRightClickedCallNodeInfo(getState())).toBeNull();

    dispatch(ProfileView.changeRightClickedCallNode(0, [0, 1]));

    expect(getRightClickedCallNodeInfo(getState())).toEqual({
      threadIndex: 0,
      callNodePath: [0, 1],
    });
  });

  it('resets right clicked call node when context menu is hidden', () => {
    const { dispatch, getState } = setup();

    dispatch(ProfileView.changeRightClickedCallNode(0, [0, 1]));

    expect(getRightClickedCallNodeInfo(getState())).toEqual({
      threadIndex: 0,
      callNodePath: [0, 1],
    });

    dispatch(ProfileView.setContextMenuVisibility(false));

    expect(getRightClickedCallNodeInfo(getState())).toBeNull();
  });
});

describe('right clicked marker info', () => {
  function setup() {
    const profile = getProfileWithMarkers([
      ['a', 0, null],
      ['b', 1, null],
      ['c', 2, null],
    ]);

    return storeWithProfile(profile);
  }

  it('should be empty on store creation', () => {
    const { getState } = setup();

    expect(getRightClickedMarkerInfo(getState())).toBeNull();
  });

  it('sets right clicked marker info when right clicked marker action is dispatched', () => {
    const { dispatch, getState } = setup();

    expect(getRightClickedMarkerInfo(getState())).toBeNull();

    dispatch(ProfileView.changeRightClickedMarker(0, 0));

    expect(getRightClickedMarkerInfo(getState())).toEqual({
      threadIndex: 0,
      markerIndex: 0,
    });
  });

  it('resets right clicked marker when context menu is hidden', () => {
    const { dispatch, getState } = setup();

    dispatch(ProfileView.changeRightClickedMarker(0, 1));

    expect(getRightClickedMarkerInfo(getState())).toEqual({
      threadIndex: 0,
      markerIndex: 1,
    });

    dispatch(ProfileView.setContextMenuVisibility(false));

    expect(getRightClickedMarkerInfo(getState())).toBeNull();
  });
});

describe('pages and active tab selectors', function() {
  // Setting some IDs here so we can use those inside the setup and test functions.
  const firstTabBrowsingContextID = 1;
  const secondTabBrowsingContextID = 4;
  const parentPageWithChildren = 11111111111;
  const iframePageWithChild = 11111111112;
  const fistTabInnerWindowIDs = [
    parentPageWithChildren,
    iframePageWithChild,
    11111111113,
    11111111115,
  ];
  const secondTabInnerWindowIDs = [11111111114, 11111111116];

  // Setup an empty profile with pages array and activeBrowsingContextID
  function setup(activeBrowsingContextID: BrowsingContextID) {
    const profile = getEmptyProfile();
    // Add a pages array with the following relationship:
    // Tab #1                           Tab #2
    // --------------                --------------
    // Page #1                        Page #4
    // |- Page #2                     |
    // |  |- Page #3                  Page #6
    // |
    // Page #5
    profile.pages = [
      // A top most page in the first tab
      {
        browsingContextID: firstTabBrowsingContextID,
        innerWindowID: parentPageWithChildren,
        url: 'Page #1',
        embedderInnerWindowID: 0,
      },
      // An iframe page inside the previous page
      {
        browsingContextID: 2,
        innerWindowID: iframePageWithChild,
        url: 'Page #2',
        embedderInnerWindowID: parentPageWithChildren,
      },
      // Another iframe page inside the previous iframe
      {
        browsingContextID: 3,
        innerWindowID: fistTabInnerWindowIDs[2],
        url: 'Page #3',
        embedderInnerWindowID: iframePageWithChild,
      },
      // A top most frame from the second tab
      {
        browsingContextID: secondTabBrowsingContextID,
        innerWindowID: secondTabInnerWindowIDs[0],
        url: 'Page #4',
        embedderInnerWindowID: 0,
      },
      // Another top most frame from the first tab
      // Their browsingContextIDs are the same because of that.
      {
        browsingContextID: firstTabBrowsingContextID,
        innerWindowID: fistTabInnerWindowIDs[3],
        url: 'Page #5',
        embedderInnerWindowID: 0,
      },
      // Another top most frame from the second tab
      {
        browsingContextID: secondTabBrowsingContextID,
        innerWindowID: secondTabInnerWindowIDs[1],
        url: 'Page #4',
        embedderInnerWindowID: 0,
      },
    ];

    // Set the active BrowsingContext ID.
    profile.meta.configuration = {
      activeBrowsingContextID,
      capacity: 1,
      features: [],
      threads: [],
    };

    // Adding an empty thread to the profile so the loadProfile function won't complain
    profile.threads.push(getEmptyThread());

    const { dispatch, getState } = storeWithProfile(profile);
    dispatch(changeViewAndRecomputeProfileData(activeBrowsingContextID));
    return { profile, dispatch, getState };
  }

  it('getPagesMap will construct the whole map correctly', function() {
    const { getState } = setup(firstTabBrowsingContextID); // the given argument is not important for this test
    const objectResult = [
      [firstTabBrowsingContextID, new Set(fistTabInnerWindowIDs)],
      [secondTabBrowsingContextID, new Set(secondTabInnerWindowIDs)],
    ];
    const result = new Map(objectResult);
    expect(ProfileViewSelectors.getPagesMap(getState())).toEqual(result);
  });

  it('getRelevantPagesForCurrentTab will get the correct InnerWindowIDs for the first tab', function() {
    const { getState } = setup(firstTabBrowsingContextID);
    expect(
      ProfileViewSelectors.getRelevantPagesForCurrentTab(getState())
    ).toEqual(new Set(fistTabInnerWindowIDs));
  });

  it('getRelevantPagesForCurrentTab will get the correct InnerWindowIDs for the second tab', function() {
    const { getState } = setup(secondTabBrowsingContextID);
    expect(
      ProfileViewSelectors.getRelevantPagesForCurrentTab(getState())
    ).toEqual(new Set(secondTabInnerWindowIDs));
  });

  it('getRelevantPagesForCurrentTab will return an empty set for an ID that is not in the array', function() {
    const { getState } = setup(99999); // a non-existent BrowsingContextID
    expect(
      ProfileViewSelectors.getRelevantPagesForCurrentTab(getState())
    ).toEqual(new Set());
  });
});
