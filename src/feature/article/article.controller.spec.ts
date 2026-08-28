jest.mock('../auth/jwt/jwt.guard', () => ({
  ManagerGuard: class ManagerGuard {},
}));
jest.mock(
  '@scspace-server/tools/file/file.storage',
  () => ({ publicStorage: {} }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/enums/article.enum',
  () => ({
    ArticleStateEnum: { HIDE: 0, FOR_KAIST: 1, FOR_ALL: 2 },
    ArticleTypeEnum: { NOTICE: 0, BUSINESS: 1, PROMOTION: 2 },
  }),
  { virtual: true },
);
jest.mock(
  '@scspace-depot/utils/user.utils',
  () => ({ UserUtils: { isManager: (type: number) => type === 2 } }),
  { virtual: true },
);
jest.mock('./article.service', () => ({
  ArticleService: class ArticleService {},
}));

import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ArticleStateEnum,
  ArticleTypeEnum,
} from '@scspace-depot/enums/article.enum';
import { ManagerGuard } from '../auth/jwt/jwt.guard';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ArticleController } from './article.controller';

describe('ArticleController visibility', () => {
  const service = {
    createArticle: jest.fn(),
    getArticles: jest.fn(),
    searchArticles: jest.fn(),
    getArticlesByType: jest.fn(),
    getArticleById: jest.fn(),
    getArticlePreviews: jest.fn(),
    updateArticle: jest.fn(),
    setArticleState: jest.fn(),
  };

  const fullArticle = (state: ArticleStateEnum) => ({
    id: 1,
    userId: 7,
    title: 'Notice',
    content: 'Content',
    timePost: 1,
    timeUpdate: 1,
    state,
    type: ArticleTypeEnum.NOTICE,
    images: null,
    files: null,
    user: {
      id: 7,
      nameKr: '관리자',
      nameEn: 'Manager',
      email: 'manager@example.com',
      studentNumber: '20260000',
    },
  });

  const fetchResult = (state: ArticleStateEnum) => ({
    articles: [fullArticle(state)],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service.createArticle.mockResolvedValue(fullArticle(ArticleStateEnum.HIDE));
    service.getArticles.mockResolvedValue(
      fetchResult(ArticleStateEnum.FOR_ALL),
    );
    service.searchArticles.mockResolvedValue(
      fetchResult(ArticleStateEnum.FOR_ALL),
    );
    service.getArticlesByType.mockResolvedValue(
      fetchResult(ArticleStateEnum.FOR_ALL),
    );
    service.getArticlePreviews.mockResolvedValue({
      notice: fullArticle(ArticleStateEnum.FOR_ALL),
      business: fullArticle(ArticleStateEnum.FOR_ALL),
      promotion: fullArticle(ArticleStateEnum.FOR_ALL),
    });
    service.updateArticle.mockResolvedValue(fullArticle(ArticleStateEnum.HIDE));
    service.setArticleState.mockResolvedValue(
      fullArticle(ArticleStateEnum.HIDE),
    );
  });

  function controller(): ArticleController {
    return new ArticleController(service as never);
  }

  it('forces FOR_ALL for the public list', async () => {
    const result = await controller().getArticles({
      state: ArticleStateEnum.HIDE,
      type: ArticleTypeEnum.NOTICE,
    });

    expect(service.getArticles).toHaveBeenCalledWith({
      state: ArticleStateEnum.FOR_ALL,
      type: ArticleTypeEnum.NOTICE,
    });
    expect(result.articles[0]).not.toHaveProperty('userId');
    expect(result.articles[0].user).toEqual({ nameKr: '관리자' });
  });

  it('forces FOR_ALL for public search and type queries', async () => {
    const searchResult = await controller().searchArticles('space', {
      state: ArticleStateEnum.HIDE,
    });
    const typeResult = await controller().getArticlesByType(
      ArticleTypeEnum.BUSINESS,
      {
        state: ArticleStateEnum.FOR_KAIST,
      },
    );

    expect(service.searchArticles).toHaveBeenCalledWith('space', {
      state: ArticleStateEnum.FOR_ALL,
    });
    expect(service.getArticlesByType).toHaveBeenCalledWith(
      ArticleTypeEnum.BUSINESS,
      {
        state: ArticleStateEnum.FOR_ALL,
      },
    );
    expect(searchResult.articles[0].user).toEqual({ nameKr: '관리자' });
    expect(typeResult.articles[0]).not.toHaveProperty('userId');
  });

  it('returns only FOR_ALL article details from the public endpoint', async () => {
    service.getArticleById.mockResolvedValueOnce(
      fullArticle(ArticleStateEnum.FOR_ALL),
    );
    await expect(controller().getArticleById(1)).resolves.toEqual({
      id: 1,
      title: 'Notice',
      content: 'Content',
      timePost: 1,
      timeUpdate: 1,
      state: ArticleStateEnum.FOR_ALL,
      type: ArticleTypeEnum.NOTICE,
      images: null,
      files: null,
      user: { nameKr: '관리자' },
    });

    service.getArticleById.mockResolvedValueOnce(
      fullArticle(ArticleStateEnum.FOR_KAIST),
    );
    await expect(controller().getArticleById(2)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('preserves unfiltered manager list and detail access', async () => {
    const query = { state: ArticleStateEnum.HIDE };
    service.getArticleById.mockResolvedValue(
      fullArticle(ArticleStateEnum.HIDE),
    );

    const list = await controller().getManagedArticles(query);
    const detail = await controller().getManagedArticleById(1);

    expect(service.getArticles).toHaveBeenCalledWith(query);
    expect(list.articles[0]).toHaveProperty('userId', 7);
    expect(list.articles[0].user).toHaveProperty(
      'email',
      'manager@example.com',
    );
    expect(detail).toHaveProperty('user.email', 'manager@example.com');
  });

  it('removes private author fields from public previews', async () => {
    const previews = await controller().getArticlePreviews();

    expect(previews.notice).not.toHaveProperty('userId');
    expect(previews.notice.user).toEqual({ nameKr: '관리자' });
  });

  it('rejects FOR_KAIST in every article state mutation path', async () => {
    const request = { user: { id: 7, type: 2 } } as never;

    await expect(
      controller().createArticle(
        request,
        {
          title: 'Notice',
          content: 'Content',
          type: ArticleTypeEnum.NOTICE,
          state: ArticleStateEnum.FOR_KAIST,
        },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller().updateArticle(1, request, {
        state: ArticleStateEnum.FOR_KAIST,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller().showArticle(1, request, {
        state: ArticleStateEnum.FOR_KAIST,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(service.createArticle).not.toHaveBeenCalled();
    expect(service.updateArticle).not.toHaveBeenCalled();
    expect(service.setArticleState).not.toHaveBeenCalled();
  });

  it('normalizes and allows only HIDE and FOR_ALL states', async () => {
    const request = { user: { id: 7, type: 2 } } as never;

    await controller().createArticle(
      request,
      {
        title: 'Notice',
        content: 'Content',
        type: ArticleTypeEnum.NOTICE,
        state: '2' as never,
      },
      {},
    );
    await controller().showArticle(1, request, { state: '0' as never });
    await controller().showArticle(1, request, { state: '2' as never });

    expect(service.createArticle).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ state: ArticleStateEnum.FOR_ALL }),
    );
    expect(service.setArticleState).toHaveBeenNthCalledWith(
      1,
      1,
      7,
      ArticleStateEnum.HIDE,
      true,
    );
    expect(service.setArticleState).toHaveBeenNthCalledWith(
      2,
      1,
      7,
      ArticleStateEnum.FOR_ALL,
      true,
    );
  });
});

describe('ArticleController manager guards', () => {
  it.each([
    'createArticle',
    'getManagedArticles',
    'getManagedArticleById',
    'getMyArticles',
    'updateArticle',
    'updateArticleImage',
    'updateArticleFile',
    'deleteArticle',
    'showArticle',
  ] as const)('guards %s with ManagerGuard', (method) => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ArticleController.prototype[method],
    );
    expect(guards).toContain(ManagerGuard);
  });
});

describe('ArticleController public routes', () => {
  it.each([
    'getArticlePreviews',
    'getArticles',
    'searchArticles',
    'getArticlesByType',
    'getArticleById',
  ] as const)('marks %s as public', (method) => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      ArticleController.prototype[method],
    );
    expect(isPublic).toBe(true);
  });
});
