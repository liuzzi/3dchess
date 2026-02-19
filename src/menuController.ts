import { Difficulty, PieceColor } from './types';
import { playMenuClick, playMenuConfirm } from './sound';

type MainMode = 'local' | 'bot' | 'online';
type ExpandableMode = Exclude<MainMode, 'local'>;

interface SubOption {
  label: string;
  detail: string;
  toneClass: string;
  onSelect: () => void;
}

export interface MenuControllerActions {
  startLocal: () => void;
  startBot: (difficulty: Difficulty) => void;
  startOnlineHost: (localColor: PieceColor) => void;
}

export function setupMenu(actions: MenuControllerActions): void {
  const menuScreen = document.getElementById('menu-screen');
  const cubeContainer = document.getElementById('menu-cubes');
  const submenu = document.getElementById('menu-submenu');
  const subCubeStack = document.getElementById('menu-subcubes');
  const backBtn = document.getElementById('menu-back-btn');
  if (!menuScreen || !cubeContainer || !submenu || !subCubeStack || !backBtn) return;

  const cubes = Array.from(cubeContainer.querySelectorAll<HTMLButtonElement>('.cube-wrapper[data-mode]'));
  const bgLayers = Array.from(menuScreen.querySelectorAll<HTMLElement>('.menu-bg-layer'));

  let expandedMode: ExpandableMode | null = null;
  let transitioning = false;

  const createCubeBody = (label: string, detail: string): HTMLDivElement => {
    const cube = document.createElement('div');
    cube.className = 'cube';
    const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
    faces.forEach((faceName) => {
      const face = document.createElement('div');
      face.className = `cube-face ${faceName}`;
      if (faceName === 'front') {
        const title = document.createElement('span');
        title.className = 'cube-title';
        title.textContent = label;
        const desc = document.createElement('span');
        desc.className = 'cube-desc';
        desc.textContent = detail;
        face.append(title, desc);
      }
      cube.appendChild(face);
    });
    return cube;
  };

  const collapseExpanded = (): void => {
    if (!expandedMode || transitioning) return;
    transitioning = true;
    expandedMode = null;
    cubeContainer.classList.remove('is-expanded');
    backBtn.classList.remove('is-visible');
    submenu.classList.remove('is-active');
    const rendered = Array.from(subCubeStack.querySelectorAll<HTMLElement>('.subcube-wrapper'));
    rendered.forEach((el) => el.classList.remove('is-visible'));
    window.setTimeout(() => {
      subCubeStack.replaceChildren();
      cubes.forEach((cube) => {
        cube.classList.remove('is-hidden', 'is-centered', 'is-selected');
      });
      transitioning = false;
    }, 260);
  };

  const renderSubOptions = (mode: ExpandableMode): void => {
    const options: SubOption[] = mode === 'bot'
      ? [
          { label: 'Easy', detail: 'Calm Play', toneClass: 'tone-soft', onSelect: () => actions.startBot('easy') },
          { label: 'Medium', detail: 'Balanced', toneClass: 'tone-mid', onSelect: () => actions.startBot('medium') },
          { label: 'Hard', detail: 'No Mercy', toneClass: 'tone-hard', onSelect: () => actions.startBot('hard') },
        ]
      : [
          { label: 'Play White', detail: 'First Move', toneClass: 'tone-white', onSelect: () => actions.startOnlineHost(PieceColor.White) },
          { label: 'Play Black', detail: 'Counterplay', toneClass: 'tone-black', onSelect: () => actions.startOnlineHost(PieceColor.Black) },
        ];

    subCubeStack.replaceChildren();
    options.forEach((option, index) => {
      const optionCube = document.createElement('button');
      optionCube.type = 'button';
      optionCube.className = `cube-wrapper subcube-wrapper ${option.toneClass}`;
      optionCube.appendChild(createCubeBody(option.label, option.detail));
      optionCube.addEventListener('click', () => {
        if (transitioning) return;
        playMenuConfirm();
        optionCube.classList.add('is-activating', 'is-selected');
        window.setTimeout(() => option.onSelect(), 220);
      });
      subCubeStack.appendChild(optionCube);
      window.setTimeout(() => optionCube.classList.add('is-visible'), 60 + index * 70);
    });
    backBtn.classList.add('is-visible');
  };

  const expandMode = (mode: ExpandableMode): void => {
    if (transitioning || expandedMode) return;
    transitioning = true;
    expandedMode = mode;
    cubeContainer.classList.add('is-expanded');
    submenu.classList.add('is-active');
    cubes.forEach((cube) => {
      cube.classList.add('is-hidden');
    });
    window.setTimeout(() => {
      renderSubOptions(mode);
      transitioning = false;
    }, 340);
  };

  cubes.forEach((cube) => {
    cube.addEventListener('click', () => {
      const modeType = cube.dataset.mode as MainMode | undefined;
      if (!modeType || transitioning) return;
      playMenuClick();

      if (modeType === 'local') {
        playMenuConfirm();
        cube.classList.add('is-activating', 'is-selected');
        window.setTimeout(() => actions.startLocal(), 220);
        return;
      }

      if (expandedMode === modeType) {
        collapseExpanded();
        return;
      }

      if (expandedMode) return;
      expandMode(modeType);
    });
  });

  backBtn.addEventListener('click', () => {
    playMenuClick();
    collapseExpanded();
  });

  menuScreen.addEventListener('pointermove', (event) => {
    const rect = menuScreen.getBoundingClientRect();
    const xNorm = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const yNorm = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    bgLayers.forEach((layer) => {
      const depth = Number(layer.dataset.depth ?? '1');
      const x = -xNorm * 18 * depth;
      const y = -yNorm * 12 * depth;
      layer.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    });
  });

  menuScreen.addEventListener('pointerleave', () => {
    bgLayers.forEach((layer) => {
      layer.style.transform = 'translate3d(0, 0, 0)';
    });
  });
}
