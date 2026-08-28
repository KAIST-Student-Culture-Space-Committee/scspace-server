import { IRental, IGoods } from '@scspace-depot/types/rental';
import { Rental, Goods } from '@schema';

export class MRental implements IRental {
    id: IRental['id'];
    userId: IRental['userId'];
    goodsId: IRental['goodsId'];
    count: IRental['count'];
    timeBorrow: IRental['timeBorrow'];
    timeDue: IRental['timeDue'];
    timeReturn: IRental['timeReturn'];
    timeConfirm: IRental['timeConfirm'];
    certName: IRental['certName'];
    groupName: IRental['groupName'];
    contact: IRental['contact'];
    emergencyContact: IRental['emergencyContact'];
    usingLocation: IRental['usingLocation'];
    usingPurpose: IRental['usingPurpose'];
    approverId: IRental['approverId'];
    returnApproverId: IRental['returnApproverId'];
    overdueContactedAt: IRental['overdueContactedAt'];
    overdueContactedById: IRental['overdueContactedById'];
    status: IRental['status'];

    constructor(data: IRental) {
        this.id = data.id;
        this.userId = data.userId;
        this.goodsId = data.goodsId;
        this.count = data.count;
        this.timeBorrow = data.timeBorrow;
        this.timeDue = data.timeDue;
        this.timeReturn = data.timeReturn;
        this.timeConfirm = data.timeConfirm;
        this.certName = data.certName;
        this.groupName = data.groupName;
        this.contact = data.contact;
        this.emergencyContact = data.emergencyContact;
        this.usingLocation = data.usingLocation;
        this.usingPurpose = data.usingPurpose;
        this.approverId = data.approverId;
        this.returnApproverId = data.returnApproverId;
        this.overdueContactedAt = data.overdueContactedAt;
        this.overdueContactedById = data.overdueContactedById;
        this.status = data.status;
    }

    static fromDB(rental: typeof Rental.$inferSelect): IRental {
        return {
            id: rental.id,
            userId: rental.userId,
            goodsId: rental.goodsId,
            count: rental.count,
            timeBorrow: rental.timeBorrow,
            timeDue: rental.timeDue,
            timeReturn: rental.timeReturn,
            timeConfirm: rental.timeConfirm,
            certName: rental.certName,
            groupName: rental.groupName,
            contact: rental.contact,
            emergencyContact: rental.emergencyContact,
            usingLocation: rental.usingLocation,
            usingPurpose: rental.usingPurpose,
            approverId: rental.approverId,
            returnApproverId: rental.returnApproverId,
            overdueContactedAt: rental.overdueContactedAt,
            overdueContactedById: rental.overdueContactedById,
            status: rental.status,
        };
    }
}

export class MGoods implements IGoods {
    id: IGoods['id'];
    name: IGoods['name'];
    description: IGoods['description'];
    countAll: IGoods['countAll'];
    countNow: IGoods['countNow'];
    imageURI: IGoods['imageURI'];

    constructor(data: IGoods) {
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.countAll = data.countAll;
        this.countNow = data.countNow;
        this.imageURI = data.imageURI;
    }

    static fromDB(goods: typeof Goods.$inferSelect): IGoods {
        return {
            id: goods.id,
            name: goods.name,
            description: goods.description,
            countAll: goods.countAll,
            countNow: goods.countNow,
            imageURI: goods.imageURI,
        };
    }
}
