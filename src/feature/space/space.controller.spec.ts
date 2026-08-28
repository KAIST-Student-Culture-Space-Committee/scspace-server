jest.mock('./space.public.service', () => ({
  SpacePublicService: class {},
}));

import { SpaceController } from './space.controller';

describe('SpaceController', () => {
  const spacePublicService = {
    fetchAll: jest.fn(),
    fetchById: jest.fn(),
  };

  function controller(): SpaceController {
    return new SpaceController(spacePublicService as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns all spaces', async () => {
    const spaces = [{ id: 1 }, { id: 2 }];
    spacePublicService.fetchAll.mockResolvedValue(spaces);

    await expect(controller().findAllSpace()).resolves.toEqual(spaces);
    expect(spacePublicService.fetchAll).toHaveBeenCalledTimes(1);
  });

  it('parses :id path parameter and fetches by id', async () => {
    const space = { id: 8 };
    spacePublicService.fetchById.mockResolvedValue(space);

    await expect(controller().findSpaceByID('8')).resolves.toEqual(space);
    expect(spacePublicService.fetchById).toHaveBeenCalledWith(8);
  });
});
